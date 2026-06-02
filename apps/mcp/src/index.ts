/**
 * Logbook MCP — remote MCP サーバ(Cloudflare Worker, Streamable HTTP)。
 * 設計: docs/mcp-design.md。web とは別 Worker・同一 D1/KV 共有。全 write は @ghs/core/services 経由(§8.5)。
 *
 * 認証(§4 / §6.3): 一次=URL 埋め込み `MCP_SHARED_SECRET`(fail-closed・定数時間比較)、
 * 二次=Anthropic outbound IP allowlist(既定 fail-open。ENFORCE_IP_ALLOWLIST=true で厳格化)。
 *
 * M2-a: get_settings 1本で疎通確認。read/write は M2-b 以降で §5.2 のカタログを追加。
 */
import {
  autocompleteFoods,
  type Db,
  deleteBodyMetric,
  deleteMeal,
  deleteWorkout,
  getActiveNutritionTarget,
  getBodyForDate,
  getBodyMetricById,
  getExerciseHistory,
  getMealById,
  getMealItems,
  getMealItemsForMeals,
  getMealsByDate,
  getMuscleCalendar,
  getMuscleVolume,
  getRecentPrs,
  getRecentSessions,
  getSettings,
  getTrainingFrequency,
  jstDaysAgo,
  LogMealInputSchema,
  listMealPresets,
  logMeal,
  logMealFromPreset,
  logWeight,
  MealItemInputSchema,
  MealType,
  makeContext,
  resolveExercise,
  SaveWorkoutInputSchema,
  saveMealPreset,
  saveWorkout,
  searchExercises,
  setNutritionTarget,
  todayJst,
  toKg,
} from '@ghs/core';
import { StreamableHTTPTransport } from '@hono/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Hono } from 'hono';
import { z } from 'zod';

export interface Env {
  DB: D1Database;
  TOKENS: KVNamespace;
  CACHE: KVNamespace;
  LOCK: KVNamespace;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FEATURE_GH_NUTRITION_PUSH?: string;
  MCP_SHARED_SECRET?: string;
  ANTHROPIC_OUTBOUND_CIDR?: string;
  ENFORCE_IP_ALLOWLIST?: string;
}

/** 定数時間比較(長さ差でも固定ステップ。タイミング攻撃で secret を漏らさない)。 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** IPv4 が CIDR(例 160.79.104.0/21)に含まれるか。二次防御用の素朴判定(v6 は対象外=スキップ)。 */
function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!range || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toInt = (s: string): number | null => {
    const p = s.split('.');
    if (p.length !== 4) return null;
    let n = 0;
    for (const o of p) {
      const v = Number(o);
      if (!Number.isInteger(v) || v < 0 || v > 255) return null;
      n = (n << 8) | v;
    }
    return n >>> 0;
  };
  const ipN = toInt(ip);
  const rN = toInt(range);
  if (ipN == null || rN == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipN & mask) === (rN & mask);
}

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
});
const READ = { readOnlyHint: true, openWorldHint: false } as const;
// 追記 write(非破壊・冪等)。GH push を伴うものは openWorldHint:true。
const WRITE_GH = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
const WRITE_LOCAL = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** clientRequestId を未指定時のみ生成(勝手に振り直すと再送が別記録になる, §6.1)。 */
function ensureCrid(provided?: string): string {
  return provided && provided.length > 0 ? provided : crypto.randomUUID();
}

/** 種目を id 優先で解決。曖昧/0件は例外でなく候補配列を返す(§5.5-A: 利用者の往復を最小化)。 */
async function resolveExerciseId(
  db: Db,
  input: string,
): Promise<
  { id: string } | { candidates: Array<{ id: string; name_en: string; name_ja: string | null }> }
> {
  try {
    const ex = await resolveExercise(db, input); // id 完全一致 → 一意名一致
    return { id: ex.id };
  } catch {
    const cands = await searchExercises(db, { query: input, limit: 8 });
    return {
      candidates: cands.map((c) => ({ id: c.id, name_en: c.name_en, name_ja: c.name_ja })),
    };
  }
}

/** リクエスト毎に McpServer を新規生成(ステートレス)。M2-a: get_settings / M2-b: read / M2-c: write。 */
function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: 'logbook-mcp', version: '0.5.0' });

  server.registerTool(
    'get_settings',
    {
      title: '設定の取得',
      description:
        '単位(kg/lb)・e1RM 式・栄養目標(phase/PFC/kcal)を返す。分析時に単位や e1RM 式を揃え、目標基準で評価するため最初に呼ぶ。引数なし。',
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      const ctx = makeContext(env);
      const [settings, nutritionTarget] = await Promise.all([
        getSettings(ctx.db),
        getActiveNutritionTarget(ctx.db),
      ]);
      return ok({ provenance: 'd1_confirmed', settings, nutritionTarget });
    },
  );

  server.registerTool(
    'get_exercise_history',
    {
      title: '種目の履歴',
      description:
        '指定種目の全セット時系列(生値 + 計算済み load_kg/set_volume_kg/e1rm_kg)を返す。分析の中核。exercise は id 推奨。名前(日本語可)も可だが曖昧時は候補配列を返すので id で再呼び出しする。',
      inputSchema: {
        exercise: z.string().min(1).describe('種目 id(推奨)または名前。曖昧なら候補が返る'),
        since: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        limit: z.number().int().min(1).max(2000).optional(),
      },
      annotations: READ,
    },
    async ({ exercise, since, limit }) => {
      const ctx = makeContext(env);
      const r = await resolveExerciseId(ctx.db, exercise);
      if (!('id' in r)) {
        return ok({
          ambiguous: true,
          candidates: r.candidates,
          hint: '候補の id を exercise に渡して再呼び出し、または search_exercises で確認',
        });
      }
      // 分析に使う意味のあるフィールドのみ返す(workout_exercise_id/created_at 等のプレースホルダは省く)。
      const sets = (await getExerciseHistory(ctx, r.id, { since, limit })).map((s) => ({
        session_id: s.session_id,
        session_date: s.session_date,
        set_index: s.set_index,
        set_type: s.set_type,
        load_mode: s.load_mode,
        entry_value: s.entry_value,
        entry_unit: s.entry_unit,
        weight_kg: s.weight_kg,
        reps: s.reps,
        rpe: s.rpe,
        load_kg: s.load_kg,
        set_volume_kg: s.set_volume_kg,
        e1rm_kg: s.e1rm_kg,
      }));
      return ok({ provenance: 'd1_confirmed', exerciseId: r.id, sets });
    },
  );

  server.registerTool(
    'get_muscle_volume',
    {
      title: '部位別ボリューム',
      description:
        '直近 windowDays 日(既定7)の部位別の実施セット数・ボリューム(kg)・週間目標比較・刺激スコアを返す。弱点部位の特定に。',
      inputSchema: { windowDays: z.number().int().min(1).max(365).optional() },
      annotations: READ,
    },
    async ({ windowDays }) => {
      const ctx = makeContext(env);
      return ok({
        provenance: 'd1_confirmed',
        muscles: await getMuscleVolume(ctx, { windowDays }),
      });
    },
  );

  server.registerTool(
    'get_muscle_calendar',
    {
      title: '部位カレンダー',
      description:
        '直近 days 日(既定30)の「いつ・どの部位を鍛えたか」を返す。sessionDates(実施日)と cells[{date,muscle,sets}](主働筋ベース)。頻度・分割の俯瞰に。',
      inputSchema: { days: z.number().int().min(1).max(120).optional() },
      annotations: READ,
    },
    async ({ days }) => {
      const ctx = makeContext(env);
      return ok({ provenance: 'd1_confirmed', ...(await getMuscleCalendar(ctx, { days })) });
    },
  );

  server.registerTool(
    'get_training_frequency',
    {
      title: '部位別トレーニング頻度',
      description:
        '部位(胸/背/肩/腕/脚/体幹)別の最終実施日・経過日数・週次「触れた」日数 + 窓内の主働セット数(total_sets)を返す。weeks 既定4。注意: last_trained は主働筋で記録された日(例: デッドリフトのハムで脚が点灯)。足りているかは total_sets で判断(少なければ副次的巻き込みのみ)。',
      inputSchema: { weeks: z.number().int().min(1).max(12).optional() },
      annotations: READ,
    },
    async ({ weeks }) => {
      const ctx = makeContext(env);
      return ok({
        provenance: 'd1_confirmed',
        regions: await getTrainingFrequency(ctx, { weeks }),
      });
    },
  );

  server.registerTool(
    'get_recent_sessions',
    {
      title: '最近のワークアウト',
      description:
        '直近のワークアウトセッション一覧(日付・名前・総ボリューム・種目数/セット数・推定消費kcal)。削除対象の id 特定にも使う。',
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: READ,
    },
    async ({ limit }) => {
      const ctx = makeContext(env);
      return ok({
        provenance: 'd1_confirmed',
        sessions: await getRecentSessions(ctx.db, limit ?? 30),
      });
    },
  );

  server.registerTool(
    'get_recent_prs',
    {
      title: '自己ベスト(PR)',
      description:
        '最近の PR 台帳(種目・値・rep_bucket・達成日)。is_provisional で暫定/確定を区別。',
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: READ,
    },
    async ({ limit }) => {
      const ctx = makeContext(env);
      return ok({ provenance: 'd1_confirmed', prs: await getRecentPrs(ctx.db, limit ?? 20) });
    },
  );

  server.registerTool(
    'search_exercises',
    {
      title: '種目検索',
      description:
        '種目を部分一致検索(name_en / name_ja。日本語名でも可)。id 解決の起点。query か muscle のどちらかを指定。muscle は chest/lats/traps/front_delts/side_delts/rear_delts/biceps/triceps/forearms/abs/obliques/quads/hamstrings/glutes/calves/lower_back。',
      inputSchema: {
        query: z.string().optional(),
        muscle: z.string().optional(),
        equipment: z.string().optional(),
        favorite: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: READ,
    },
    async ({ query, muscle, equipment, favorite, limit }) => {
      const ctx = makeContext(env);
      const rows = await searchExercises(ctx.db, { query, muscle, equipment, favorite, limit });
      return ok({
        provenance: 'd1_confirmed',
        exercises: rows.map((e) => ({
          id: e.id,
          name_en: e.name_en,
          name_ja: e.name_ja,
          equipment: e.equipment,
          laterality: e.laterality,
          load_basis: e.load_basis,
          is_bodyweight: e.is_bodyweight,
          bw_factor: e.bw_factor,
        })),
      });
    },
  );

  server.registerTool(
    'autocomplete_foods',
    {
      title: '食品オートコンプリート',
      description:
        '過去に記録した食品の PFC を名前部分一致で再利用候補として返す(log_meal の補助)。',
      inputSchema: { q: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
      annotations: READ,
    },
    async ({ q, limit }) => {
      const ctx = makeContext(env);
      return ok({
        provenance: 'd1_confirmed',
        foods: await autocompleteFoods(ctx.db, q, limit ?? 8),
      });
    },
  );

  server.registerTool(
    'get_day',
    {
      title: '日次の俯瞰',
      description:
        '指定日(既定 今日JST)の食事(PFC合計+品目明細)・ワークアウト・体重をまとめて返す。1日の横断把握に。',
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      },
      annotations: READ,
    },
    async ({ date }) => {
      const ctx = makeContext(env);
      const d = date ?? todayJst();
      const meals = await getMealsByDate(ctx.db, d);
      const itemsByMeal = await getMealItemsForMeals(
        ctx.db,
        meals.map((m) => m.id),
      );
      const mealsOut = meals.map((m) => ({
        id: m.id,
        meal_type: m.meal_type,
        logged_at: m.logged_at,
        items: (itemsByMeal.get(m.id) ?? []).map((it) => ({
          food_name: it.food_name,
          calories_kcal: it.calories_kcal,
          protein_g: it.protein_g,
          fat_g: it.fat_g,
          carbs_g: it.carbs_g,
          fiber_g: it.fiber_g,
          sugar_g: it.sugar_g,
          sodium_mg: it.sodium_mg,
        })),
      }));
      const totals = mealsOut
        .flatMap((m) => m.items)
        .reduce(
          (a, it) => ({
            kcal: a.kcal + it.calories_kcal,
            p: a.p + it.protein_g,
            f: a.f + it.fat_g,
            c: a.c + it.carbs_g,
            fiber: a.fiber + (it.fiber_g ?? 0),
            sugar: a.sugar + (it.sugar_g ?? 0),
            sodium_mg: a.sodium_mg + (it.sodium_mg ?? 0),
          }),
          { kcal: 0, p: 0, f: 0, c: 0, fiber: 0, sugar: 0, sodium_mg: 0 },
        );
      const body = await getBodyForDate(ctx.db, d);
      const workouts = (await getRecentSessions(ctx.db, 50)).filter((s) => s.date === d);
      return ok({
        provenance: 'd1_confirmed',
        date: d,
        nutrition: { totals, meals: mealsOut },
        workouts,
        body,
      });
    },
  );

  // ===== M2-c: write(全て @ghs/core/services 経由・§8.5。GH push 成否を ghPushed で正直に返す)=====

  server.registerTool(
    'log_meal',
    {
      title: '食事を記録',
      description:
        '食事(items の合算)を D1 に記録し GH へ push。栄養値(kcal 必須、PFC/繊維/糖/ナトリウム任意)は呼び出し側が見積もって渡す。同じ記録の再送防止に clientRequestId を再利用(省略時はサーバ生成し結果に返す)。kcal は kcal、各栄養は g、sodium は mg。',
      inputSchema: LogMealInputSchema.shape,
      annotations: WRITE_GH,
    },
    async (args) => {
      const ctx = makeContext(env);
      const input = LogMealInputSchema.parse(args);
      const clientRequestId = ensureCrid(input.clientRequestId);
      const res = await logMeal(ctx, { ...input, clientRequestId });
      return ok({ ...res, clientRequestId });
    },
  );

  server.registerTool(
    'log_workout',
    {
      title: 'ワークアウトを記録',
      description:
        'ワークアウト(種目×セット)を D1 に記録し GH へ push。e1RM/PR/総ボリュームは core が計算。exerciseId は search_exercises で解決した id。重量種目は entryValue 必須(自重は省略可=bodyweight、reps のみでよい)。entryUnit は kg/lb。loadMode 省略時は種目マスタに従う。title は不要(主働筋の部位から自動命名)。clientRequestId は再送で再利用。',
      inputSchema: SaveWorkoutInputSchema.shape,
      annotations: WRITE_GH,
    },
    async (args) => {
      const ctx = makeContext(env);
      const input = SaveWorkoutInputSchema.parse(args);
      const clientRequestId = ensureCrid(input.clientRequestId);
      const res = await saveWorkout(ctx, { ...input, clientRequestId });
      return ok({ ...res, clientRequestId });
    },
  );

  server.registerTool(
    'log_weight',
    {
      title: '体重を記録',
      description:
        '体重(+任意で体脂肪%)を手入力で記録し GH へ push。entryUnit は kg/lb。同日に近い記録があると status:"similar_exists" を返すので、別測定(朝晩など)なら confirm:true を付けて再呼び出し、重複なら呼ばない。',
      inputSchema: {
        entryValue: z.number().positive().max(1000),
        entryUnit: z.enum(['kg', 'lb']),
        bodyFatPct: z.number().min(0).max(70).optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        measuredAtSec: z.number().int().nonnegative().optional(),
        confirm: z.boolean().optional().describe('同日重複の警告を承知で記録する'),
      },
      annotations: WRITE_GH,
    },
    async ({ entryValue, entryUnit, bodyFatPct, date, measuredAtSec, confirm }) => {
      const ctx = makeContext(env);
      const d = date ?? todayJst();
      if (!confirm) {
        const existing = await getBodyForDate(ctx.db, d);
        if (
          existing.weightKg != null &&
          Math.abs(existing.weightKg - toKg(entryValue, entryUnit)) < 0.5
        ) {
          return ok({
            status: 'similar_exists',
            requireConfirm: true,
            existing: {
              weight_kg: existing.weightKg,
              body_fat_pct: existing.bodyFatPct,
              source: existing.source,
            },
            message: `同日(${d})に ${existing.weightKg}kg の記録があります。別測定なら confirm:true で記録します。`,
          });
        }
      }
      const res = await logWeight(ctx, { entryValue, entryUnit, bodyFatPct, date, measuredAtSec });
      return ok(res);
    },
  );

  server.registerTool(
    'set_nutrition_target',
    {
      title: '栄養目標を設定',
      description:
        '栄養目標(phase=bulk/cut/maintain、kcal、P/F/C g、任意で塩 g・繊維 g、適用開始日)を設定。AI が目標基準で分析・提案するための基準。dateFrom 省略時は今日から適用(同日は上書き)。',
      inputSchema: {
        phase: z.enum(['bulk', 'cut', 'maintain']),
        kcal: z.number().positive().max(10000),
        proteinG: z.number().min(0).max(1000),
        fatG: z.number().min(0).max(1000),
        carbsG: z.number().min(0).max(2000),
        saltG: z.number().min(0).max(100).optional(),
        fiberG: z.number().min(0).max(200).optional(),
        dateFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      },
      annotations: WRITE_LOCAL,
    },
    async (args) => {
      const ctx = makeContext(env);
      await setNutritionTarget(ctx, args);
      return ok({ ok: true });
    },
  );

  server.registerTool(
    'get_meal_presets',
    {
      title: '食事プリセット一覧',
      description:
        '保存済みの食事プリセット(id / name / default_meal_type / use_count / items[])を返す。log_preset で id 指定 + servings 倍率で按分記録する。',
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      const ctx = makeContext(env);
      const presets = (await listMealPresets(ctx.db)).map((p) => ({
        id: p.id,
        name: p.name,
        default_meal_type: p.default_meal_type,
        use_count: p.use_count,
        items: JSON.parse(p.items_json),
      }));
      return ok({ provenance: 'd1_confirmed', presets });
    },
  );

  server.registerTool(
    'save_meal_preset',
    {
      title: '食事プリセットを保存',
      description:
        'よく食べる構成をプリセット保存。栄養値は「1 serving 分」で登録する(例: WPI 30g を 1 serving として登録 → 後で log_preset の servings=1.3333 で 40g 記録できる)。',
      inputSchema: {
        name: z.string().min(1).max(80),
        defaultMealType: MealType,
        items: MealItemInputSchema.array().min(1).max(50),
      },
      annotations: WRITE_LOCAL,
    },
    async ({ name, defaultMealType, items }) => {
      const ctx = makeContext(env);
      return ok(await saveMealPreset(ctx, { name, defaultMealType, items }));
    },
  );

  server.registerTool(
    'log_preset',
    {
      title: 'プリセットから記録',
      description:
        'プリセット(presetId)から食事を記録し GH へ push。servings 倍率で全栄養素を按分する(例: 30g 登録のプリセットを 40g 記録 → servings=1.3333)。省略時は 1。mealType 省略時はプリセット既定。clientRequestId は再送で再利用。',
      inputSchema: {
        presetId: z.string().min(1),
        servings: z.number().positive().max(50).optional().describe('倍率。例 30g→40g は 1.3333'),
        mealType: MealType.optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        loggedAtSec: z.number().int().nonnegative().optional(),
        note: z.string().max(500).optional(),
        clientRequestId: z.string().min(1).max(64).optional(),
      },
      annotations: WRITE_GH,
    },
    async (args) => {
      const ctx = makeContext(env);
      const clientRequestId = ensureCrid(args.clientRequestId);
      const res = await logMealFromPreset(ctx, { ...args, clientRequestId });
      return ok({ ...res, clientRequestId });
    },
  );

  server.registerTool(
    'log_meal_photo',
    {
      title: '写真から食事を記録',
      description:
        '食事写真を見て解析した内容(items[])を記録し GH へ push。画像は **あなた(Claude)が視覚解析**して栄養値(kcal/PFC 等)を見積もり items[] に変換して渡す(画像バイナリは渡さない)。inputMethod は photo 固定。それ以外は log_meal と同契約。',
      inputSchema: LogMealInputSchema.shape,
      annotations: WRITE_GH,
    },
    async (args) => {
      const ctx = makeContext(env);
      const input = LogMealInputSchema.parse(args);
      const clientRequestId = ensureCrid(input.clientRequestId);
      const res = await logMeal(ctx, { ...input, inputMethod: 'photo', clientRequestId });
      return ok({ ...res, clientRequestId });
    },
  );

  // ===== M2-d: destructive(直近の取消のみ。echo+confirm 二段, §5.5-D/E・§6.4)=====
  server.registerTool(
    'delete_recent_log',
    {
      title: '直近の記録を取消',
      description:
        '直近の食事 / ワークアウト / 体重を取消(D1 削除 + GH datapoint も削除)。confirm 省略時は削除せず対象内容を echo するので、確認して confirm:true で実行する。**訂正は「取消→再記録」が公式フロー**(編集ツールは無い)。対象は当日(JST)作成(食事/体重は前日まで、ワークアウトは加えて最新3件まで)。範囲外はエラー。',
      inputSchema: {
        type: z.enum(['meal', 'workout', 'weight']),
        id: z.string().min(1),
        confirm: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ type, id, confirm }) => {
      const ctx = makeContext(env);
      const today = todayJst();
      if (type === 'workout') {
        const sessions = await getRecentSessions(ctx.db, 20);
        const target = sessions.find((s) => s.id === id);
        const recent =
          !!target && (target.date === today || sessions.slice(0, 3).some((s) => s.id === id));
        if (!target || !recent) {
          return ok({
            error: 'not_recent',
            message:
              '直近(当日 or 最新3件)のワークアウトのみ取消可能。get_recent_sessions で対象 id を確認してください。',
          });
        }
        if (!confirm) {
          return ok({
            requireConfirm: true,
            target: {
              id: target.id,
              date: target.date,
              title: target.title,
              total_volume_kg: target.total_volume_kg,
              exercises: target.exercises,
              sets: target.sets,
            },
            message: `${target.date} ${target.title ?? 'ワークアウト'}(${target.exercises}種目 ${target.sets}set)を削除します。confirm:true で実行。`,
          });
        }
        return ok(await deleteWorkout(ctx, id));
      }
      if (type === 'weight') {
        const bm = await getBodyMetricById(ctx.db, id);
        if (!bm || bm.date < jstDaysAgo(1)) {
          return ok({
            error: 'not_recent',
            message: '直近(当日/前日)の体重のみ取消可能。get_day で対象 id を確認してください。',
          });
        }
        if (!confirm) {
          return ok({
            requireConfirm: true,
            target: { id, date: bm.date, weight_kg: bm.weight_kg, body_fat_pct: bm.body_fat_pct },
            message: `${bm.date} の体重 ${bm.weight_kg}kg を削除します。confirm:true で実行。`,
          });
        }
        return ok(await deleteBodyMetric(ctx, id));
      }
      // meal: 当日/前日のみ取消可
      const meal = await getMealById(ctx.db, id);
      if (!meal || meal.date < jstDaysAgo(1)) {
        return ok({
          error: 'not_recent',
          message: '直近(当日/前日)の食事のみ取消可能。get_day で対象 id を確認してください。',
        });
      }
      if (!confirm) {
        const items = await getMealItems(ctx.db, id);
        const kcal = Math.round(items.reduce((a, it) => a + it.calories_kcal, 0));
        const label = items[0]
          ? `${items[0].food_name}${items.length > 1 ? ` 他${items.length - 1}品` : ''}`
          : '食事';
        return ok({
          requireConfirm: true,
          target: { id, date: meal.date, meal_type: meal.meal_type, label, kcal },
          message: `${meal.date} ${meal.meal_type} / ${label}(${kcal}kcal)を削除します。confirm:true で実行。`,
        });
      }
      return ok(await deleteMeal(ctx, id));
    },
  );

  return server;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.text('ok'));
app.get('/', (c) => c.text('Logbook MCP. Connect via /mcp (Streamable HTTP).'));

// 認証ガード(/mcp のみ)。一次 secret は fail-closed、二次 IP は既定 fail-open(§6.3)。
app.use('/mcp', async (c, next) => {
  const provided = c.req.query('key') ?? c.req.header('x-mcp-secret') ?? '';
  const expected = c.env.MCP_SHARED_SECRET ?? '';
  if (!expected || !timingSafeEqual(provided, expected)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const cidr = c.env.ANTHROPIC_OUTBOUND_CIDR;
  if (cidr) {
    const ip = c.req.header('cf-connecting-ip') ?? '';
    const allowed = ip.includes(':') // IPv6 は当面判定対象外(v4 allowlist のみ)
      ? true
      : cidr.split(',').some((r) => ipv4InCidr(ip, r.trim()));
    if (!allowed) {
      console.warn(JSON.stringify({ evt: 'ip_not_in_allowlist', ip }));
      if (c.env.ENFORCE_IP_ALLOWLIST === 'true') return c.json({ error: 'forbidden' }, 403);
    }
  }
  await next();
});

app.all('/mcp', async (c) => {
  const server = buildServer(c.env);
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined }); // ステートレス
  await server.connect(transport);
  const res = await transport.handleRequest(c);
  return res ?? c.body(null, 204);
});

export default app;

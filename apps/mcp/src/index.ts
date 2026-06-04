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
  deleteMealPresetRow,
  deleteRoutine,
  deleteWorkout,
  getActiveNutritionTarget,
  getBodyForDate,
  getBodyMetricById,
  getDailyMetricsByDate,
  getExerciseHistory,
  getExerciseMusclesForExercises,
  getExistingExerciseIds,
  getMealById,
  getMealItems,
  getMealItemsForMeals,
  getMealRecoveryCorrelation,
  getMealsByDate,
  getMuscleCalendar,
  getMuscleLoadRatios,
  getMuscleVolume,
  getNutritionScore,
  getNutritionStatus,
  getPlateauIndicators,
  getReadiness,
  getRecentPrs,
  getRecentSessions,
  getRoutine,
  getRoutines,
  getSessionsByDate,
  getSettings,
  getSleepByDate,
  getTrainingFrequency,
  getWeeklySummaryNow,
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
  type SaveRoutineInput,
  SaveWorkoutInputSchema,
  saveMealPreset,
  saveRoutine,
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
import { ipv4InCidr, timingSafeEqual } from './auth';

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

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
});
const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  isError: true,
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
  const server = new McpServer(
    { name: 'logbook-mcp', version: '0.9.0' },
    {
      instructions:
        'Logbook = オーナー1名のボディメイク用ログ(食事/ワークアウト/体重)+ Google Health センシング。\n' +
        '開発者=利用者(オーナー本人)。ツールの不足・誤り・改善要望があれば遠慮なくチャットで伝えてよい(その場で実装・修正される)。\n' +
        '規約: 単位は kg/kcal/g(sodium は mg)、日付は JST の YYYY-MM-DD。種目は search_exercises で id を解決(日本語俗称・略称も可)。\n' +
        '食事は app→D1→GH の一方向(GH から栄養は読まない)。write の ghPushed / delete の ghDeleted は GH 反映の真偽。冪等は clientRequestId を再利用。\n' +
        'エネルギー収支: 維持カロリー(総消費)は get_nutrition_status の estimatedTdeeKcal(体重トレンド×摂取の逆算)を優先。' +
        '日次の目安は get_day.sensing.active_energy_kcal(活動分)+ BMR(身体プロフィールから get_nutrition_status が Mifflin で算出)。\n' +
        '当日のセンシング/睡眠は Fitbit→GH ミラーで数時間遅れることがある(前日まではほぼ確定)。',
    },
  );

  for (const register of REGISTRARS) register(server, env);
  return server;
}

// ===== read(分析/参照・トレーナーAI/UI 用)=====
function registerReadTools(server: McpServer, env: Env) {
  server.registerTool(
    'get_settings',
    {
      title: '設定・栄養目標の取得',
      description: `オーナーの設定と現在有効な栄養目標を返す(引数なし)。返り値: settings={unit_preference(kg/lb), e1rm_formula, locale, updated_at}、nutritionTarget={phase(bulk/cut/maintain), target_kcal, target_protein_g/target_fat_g/target_carbs_g(g), target_salt_g(食塩相当量gの上限), target_fiber_g(g下限), date_from(適用開始日)}。いつ使うか: 食事/トレ分析の前提を揃えるため最初に呼ぶ(表示単位・e1RM式を合わせ、目標基準で過不足を評価する)。注意: nutritionTarget は目標未設定だと null。栄養素は g・kcal は kcal・salt は g(食事ログ側の sodium は mg なので混同しない)。目標の変更は set_nutrition_target。`,
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
      title: '種目の履歴(全セット時系列)',
      description: `指定1種目の全セットを時系列(日付降順)で返す。1種目の進捗・強度推移の深掘り分析の中核。各セットは生値(entry_value/entry_unit/reps/rpe)と計算済みの load_kg(実効荷重)/set_volume_kg(=load×reps)/e1rm_kg(推定1RM, kg)を持つ。e1rm_kg は reps>12 もしくは reps/重量が欠損だと null。warmup セットも含まれる。exercise は search_exercises で解決した id を渡すのが確実。日本語名でも可だが曖昧なら candidates 配列(+hint)を返すので id で再呼び出しすること。since(JST YYYY-MM-DD, 省略=全期間)以降に絞れる。limit 省略時は500件・最大2000。status=stale の中断セッションは除外。複数種目の俯瞰は get_recent_sessions / get_day を使う。`,
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
      title: '部位別ボリューム(間接含む総刺激)',
      description: `直近 windowDays 日(既定7・当日含む)の16筋群別(chest/triceps/front_delts 等の粒度)の刺激量を返す。『その部位が十分に鍛えられているか(間接刺激まで含めた総刺激)』を見るための唯一の正規ツール。各筋群は actual_sets(実施セット数)/volume_kg(挙上ボリューム kg)/target_sets・vs_target(週間目標との比)/stimulus(0..1 の相対ヒートマップ強度)/landmark_zone(under=MEV未満/building/optimal=MAV帯=最も伸びやすい/high/over=MRV超)/landmarks{mev,mav_low,mav_high,mrv}(RP/Israetel の週間セット数ガイドライン。個人差ありの出発点であって検証済み個人閾値ではない)を持つ。【重要】actual_sets と landmark_zone は主働だけでなく間接関与(secondary/stabilizer)も各1セットとして計上した総量基準。よって複合種目の多い筋群(三頭/前三角等)は高めに出る一方、これこそが『間接含めて足りているか』の正しい指標。warmup は除外。『どの日に何の分割(主働)をやったか』は get_muscle_calendar / get_training_frequency を見ること(あちらは主働のみ集計で基準が違う)。`,
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
      title: '部位カレンダー(主働の分割)',
      description: `直近 days 日(既定30・当日含む)の『いつ・どの筋群を鍛えたか』を返す。返り値は sessionDates(実施日。warmupのみの日も rest 日判定のため含む)と cells[{date, muscle(16筋群ID), sets}]。頻度・分割(週何分割か、連続でどこを叩いたか)の俯瞰用。【基準】cells の sets は各種目の主働筋(primary mover)にのみ帰属させた working セット数で、間接関与(secondary/stabilizer)は含めない(ベンチ=胸であって腕ではない)。warmup は sets 集計から除外。したがって『何の日をやったか(分割)』はここで分かるが、『その筋群が間接刺激まで含めて十分鍛えられているか』は get_muscle_volume の actual_sets / landmark_zone を見ること(あちらは間接も計上する総量基準)。区分(胸/背/肩/腕/脚/体幹)単位の頻度サマリは get_training_frequency。`,
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
      title: '部位別トレーニング頻度(主働の分割)',
      description: `表示区分(胸/背/肩/腕/脚/体幹の6区分)ごとに last_trained_date(最終実施日)/days_since(経過日数)/weekly_counts(週次で『その区分を触れた』日数。weekly_counts[0]=直近7日, [1]=8〜14日前…)/ total_sets(窓内の主働セット数)を返す。weeks 既定4・当日含む。分割の偏り・各部位を最後にいつ叩いたかの即答用(get_muscle_calendar の区分ロールアップ版で軽い)。【重要な罠】last_trained・total_sets は主働筋(primary mover)で記録された日/セットのみを数える(例: デッドリフトのハムで脚が点灯)。total_sets が少ない=主働で直接叩いていないだけで、プレス由来の三頭・前三角のように間接刺激は十分なことが多い。total_sets だけを見て『その部位が手薄/足りない』と結論しないこと。間接刺激まで含めた十分性(足りているか)は必ず get_muscle_volume の actual_sets / landmark_zone で確認する。warmup は除外。`,
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
      title: '最近のワークアウト一覧',
      description: `直近の完了(completed)ワークアウトセッション一覧を新しい順(started_at 降順)で返す。各行は id / date(JST) / title(主働筋から自動命名, 例『胸・腕』) / total_volume_kg(総挙上ボリューム kg) / exercises(種目数) / sets(総セット数) / est_calories(推定消費 kcal=METs ベースの保守的推定で実測ではない)。limit 既定30。in_progress / stale は含まない。直近に何をやったかの俯瞰や、記録の取消対象(delete_recent_log で使う session id)の特定に使う。記録の修正に編集ツールは無く、取消(delete_recent_log)→再記録が公式フロー。1日の全データは get_day、1種目の全セットは get_exercise_history。`,
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
      title: '自己ベスト(e1RM PR)台帳',
      description: `最近の e1RM(推定1RM, kg)PR 台帳を達成日の新しい順(achieved_at 降順)で返す。各行は exercise_id / name(種目名) / value(推定1RM kg) / pr_basis / is_provisional / achieved_at。あくまで実測1RMではなく各セットから算出した推定1RM の更新履歴。pr_basis は確度根拠: amrap・failure・rpe_backed(RPE入力あり)は確定扱い、rpe_less は RPE 未入力で推定確度が低い。is_provisional=true は pr_basis が rpe_less と同義で、実測より低めに出やすい暫定値 —『暫定』と断った上で扱い、確定PRと同格に誇張・祝福しないこと。limit 既定20。1種目の全セット推移は get_exercise_history。`,
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: READ,
    },
    async ({ limit }) => {
      const ctx = makeContext(env);
      return ok({ provenance: 'd1_confirmed', prs: await getRecentPrs(ctx.db, limit ?? 20) });
    },
  );

  server.registerTool(
    'get_weekly_summary',
    {
      title: '週間サマリー(直近7日)',
      description: `直近7日(当日JST含む)の総合サマリーを返す。range(start/end)と、training{sessions, volumeKg(総挙上), prs}・nutrition{daysLogged, avgKcal/avgP/avgF/avgC/avgSodiumMg/avgFiberG}・sleep{nights, avgTotalMin, avgEfficiency}・sensing{avgSteps/avgActiveKcal/avgRestingHr/avgHrv}・body{startKg/endKg/deltaKg}+ target(有効な栄養目標)。いつ使うか: 週の振り返り・講評・調子の俯瞰に。注意: 栄養平均は記録のあった日(daysLogged)を分母にした平均(未記録日は含まない)。睡眠はその日の最長を主睡眠とみなした平均。prs は窓内の e1RM PR 件数で暫定PR(RPE推定)も含むため、内訳・確度は get_recent_prs を見る。欠損は null。使い分け: 指定1日の詳細は get_day、コンディション信号+部位別負荷は get_readiness。`,
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      const ctx = makeContext(env);
      const [summary, target] = await Promise.all([
        getWeeklySummaryNow(ctx.db),
        getActiveNutritionTarget(ctx.db),
      ]);
      return ok({ provenance: 'd1_confirmed', ...summary, target });
    },
  );

  server.registerTool(
    'get_readiness',
    {
      title: 'コンディション信号(Readiness)',
      description: `指定日のコンディションを『あなた自身の過去データに対する相対逸脱の事実』として返す(date 省略で当日JST)。中核=夜間HRV(rMSSD, ln→7日ローリング平均; Plews/Buchheit)、補助=安静時心拍/呼吸数、文脈=皮膚温/睡眠時間・効率。各 contributor は {metric,label,unit,isCore,status(ready/learning/no-data),daysOfData,current(実測値・no-dataは null),baselineMedian,normalLow/High(あなたの平常範囲),deviation(low/normal/high),signal(green/yellow/red)}。overall は N-of-M(2指標以上同時に悪方向逸脱 or 中核HRVの赤で全体赤)で統合し、偽の0-100合成スコアは出さない。ベースライン未確立(<14日)・データ不足は overall.status=learning で判定を出さず learningRemainingDays を返す。併せて muscleLoad[]={muscle, acute7_sets(直近7日の総セット数=間接関与も1と計上), chronic_weekly_sets(直近28日の週平均), ratio(acute7/chronic_weekly・慢性が薄い部位は null), trend(detraining<0.8 / steady<=1.3 / ramping<=1.5 / spiking)}。重要: muscleLoad の set 数は get_muscle_volume と同じ総量基準(間接含む)であり、frequency/calendar の主働のみ集計とは別系統 —『どの部位の日をやったか(主働の分割)』は get_muscle_calendar / get_training_frequency を見よ。muscleLoad は ACWR の怪我予測ではなく(学術的に否定済)漸進性過負荷の記述指標。全体として医学的診断でもパフォーマンス予測でもなく相対逸脱の事実のみ —『休め/病気だ/成績が上がる』と断定せず、HRVが平常下/呼吸が上がっている/特定部位を急増させた等の事実を踏まえて会話で助言すること。注意: 当日指定は HRV/RHR 等が GH ミラー遅延で未確定/欠損になりやすく、確実な評価は前日指定が無難。使い分け: 1日の全データは get_day、直近7日集計は get_weekly_summary。`,
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
      const [readiness, muscleLoad] = await Promise.all([
        getReadiness(ctx.db, date),
        getMuscleLoadRatios(ctx),
      ]);
      return ok({ provenance: 'd1_confirmed', ...readiness, muscleLoad });
    },
  );

  server.registerTool(
    'get_nutrition_status',
    {
      title: '適応型TDEE/栄養ステータス',
      description:
        '体重トレンド(直近 windowDays 日・既定28の直線回帰)× 食事摂取から**実測ベースで消費(TDEE)を逆算**して返す(MacroFactor 方式)。{ daysLogged, avgIntakeKcal, weightTrend{startKg,endKg,perWeekKg}, estimatedTdeeKcal, confidence(high/medium/low/insufficient), bmrKcal(身体プロフィール settings があれば Mifflin-St Jeor), phase, targetKcal, intakeVsTargetKcal }。**推定値であり実測の代謝測定ではない**。体重トレンドが7日未満 or 食事記録が7日未満は confidence=insufficient で TDEE を出さない(遵守ゲート)。記録日数が窓の半分未満は confidence=low。Claude は「来週 ±◯kcal、根拠は…」と会話で提案する材料に使う(数値の断定はしない)。',
      inputSchema: { windowDays: z.number().int().min(7).max(120).optional() },
      annotations: READ,
    },
    async ({ windowDays }) => {
      const ctx = makeContext(env);
      return ok({ provenance: 'd1_confirmed', ...(await getNutritionStatus(ctx, { windowDays })) });
    },
  );

  server.registerTool(
    'get_nutrition_score',
    {
      title: '食事スコア(マクロ目標適合度・レーダー)',
      description:
        '指定日(既定=今日)の食事を「1日全体」と「カテゴリ別(朝昼夕・**間食は除外**)」で、たんぱく質/脂質/糖質/食物繊維/塩分の**5軸 × 目標適合度**を 0..1 で採点(台形バンド+加重幾何平均)。返り値: { day{axes[{key,labelJa,value,target,score,zone,weight}],overall,calories{kcal,target,ratio,gate}}, categories[{mealType,labelJa,score}], meals[{mealType,foods[]}], uncomputable[], note }。**カロリーは軸でなく収支ゲート+実数**(>1.25T 超過/<0.8T 赤字で総合に上限)。**質(脂質の質・血糖負荷GI/GL・食事の質/微量栄養)はアプリでは採点しない** — fat_g 総量しか持たず GI も持たず food_name は自由テキストで非決定的なため(uncomputable に理由)。**代わりに各食事の food_name を meals で返すので、あなた(トレーナーAI)が会話で質を判断すること**(「P満点だが揚げ物中心=脂質の質が低い」等)。欠損軸は score=null(—)で0扱いしない。phase(cut/bulk/maintain)で加重が変わる。',
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
      return ok({ provenance: 'd1_confirmed', ...(await getNutritionScore(ctx, date)) });
    },
  );

  server.registerTool(
    'get_plateau_indicators',
    {
      title: '種目別 停滞検知(e1RM)',
      description:
        '直近 windowDays 日(既定56)で各種目のセッション最高 e1RM を集計し、前半 vs 後半の最高で trend(progressing/plateau/declining)を記述分類して返す。{ exercise_id, name, trend, early_best_e1rm, late_best_e1rm, pct_change, sessions }。3セッション以上の種目のみ。±2% を停滞帯とする工学的閾値。**これは判定材料であり「デロードせよ」等の処方はしない** — Claude が会話で「ベンチが3週間停滞→デロードやレップ調整を検討?」と提案する。e1RM は推定1RM(reps>12 等は除外済)。',
      inputSchema: { windowDays: z.number().int().min(14).max(180).optional() },
      annotations: READ,
    },
    async ({ windowDays }) => {
      const ctx = makeContext(env);
      return ok({
        provenance: 'd1_confirmed',
        plateaus: await getPlateauIndicators(ctx, { windowDays }),
      });
    },
  );

  server.registerTool(
    'get_meal_recovery_correlation',
    {
      title: '食事×翌朝の回復 相関',
      description:
        '直近 days 日(既定28)の食事(塩分/糖質/炭水化物/最後の食事時刻)と**翌朝**の回復(HRV/安静時心拍/睡眠効率)を層別クロス。各 dimension を中央値で高/低に分け、各回復指標の**中央値差と n** のみ返す: { dimension, split, metric, highN, lowN, highMedian, lowMedian, diff }。**因果・p値・相関係数は出さない**(実測主義)。各群 n<5 は出さない(発見なしは findings 空)。「高塩分の翌朝は安静時心拍が高め(中央値+3bpm, n=18)」のような事実提示にとどめ、Claude は傾向として慎重に扱う。D1食事正本 × GH回復ミラーの両方を持つ本アプリ固有の分析。',
      inputSchema: { days: z.number().int().min(14).max(120).optional() },
      annotations: READ,
    },
    async ({ days }) => {
      const ctx = makeContext(env);
      return ok({
        provenance: 'd1_confirmed',
        ...(await getMealRecoveryCorrelation(ctx, { days })),
      });
    },
  );

  server.registerTool(
    'search_exercises',
    {
      title: '種目検索',
      description: `種目マスタを検索し id を解決する起点ツール(log_workout の exerciseId はここで解決)。query は name_en / name_ja / エイリアス辞書(日本語俗称・略称・マシンのブランド名)を横断部分一致。返り値 exercises[] は id・name_en・name_ja・equipment・laterality(bilateral/unilateral)・load_basis(total/per_limb/per_side)・is_bodyweight・bw_factor(自重係数)に加え、muscles[{muscle, role(primary/secondary/stabilizer), contribution}] を含む。この muscles[] の重み(contribution・role)は get_muscle_volume の集計と完全に同じで、部位マッピングの妥当性検証にも使える。フィルタ: equipment(barbell/dumbbell/machine/cable/bodyweight/smith/band/kettlebell/other)・favorite(お気に入りのみ)で絞り込み可。muscle を指定すると逆引き(その部位を主働 primary または間接 secondary に持つ種目)= 安定筋 stabilizer のみの種目はヒットしない点に注意。query / muscle を省略すると全種目を返す(limit 既定50・最大200=全カタログ監査可)。並び順は お気に入り→名前。muscle に使える部位 id: chest/lats/traps/front_delts/side_delts/rear_delts/biceps/triceps/forearms/abs/obliques/quads/hamstrings/glutes/calves/lower_back。注意: 部位の数え方は2系統ある。『何の日をやったか(主働の分割)』は get_training_frequency / get_muscle_calendar、『その部位が間接刺激まで含め十分鍛えられているか』は get_muscle_volume の actual_sets / landmark_zone を見る — 本ツールの muscles[] は後者(間接含む重み)と同じ基準。`,
      inputSchema: {
        query: z.string().optional(),
        muscle: z.string().optional(),
        equipment: z.string().optional(),
        favorite: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ,
    },
    async ({ query, muscle, equipment, favorite, limit }) => {
      const ctx = makeContext(env);
      const rows = await searchExercises(ctx.db, { query, muscle, equipment, favorite, limit });
      // 部位マッピング(role + contribution)を一括取得して各種目に付与(マッピング妥当性の検証用)。
      const links = await getExerciseMusclesForExercises(
        ctx.db,
        rows.map((e) => e.id),
      );
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
          muscles: (links.get(e.id) ?? []).map((m) => ({
            muscle: m.muscle_group_id,
            role: m.role,
            contribution: m.contribution,
          })),
        })),
      });
    },
  );

  server.registerTool(
    'autocomplete_foods',
    {
      title: '食品オートコンプリート',
      description: `過去に記録した食品を food_name の部分一致で検索し、再利用候補として返す(log_meal の items を埋める補助)。同名食品は最新の記録行をそのまま1件返す(食品名で重複排除・最新1件のみ・古い記録や別量バリエーションは返らない)。返り値 foods[] は food_name・quantity・unit に加え栄養値 calories_kcal・protein_g・fat_g・carbs_g・fiber_g・sugar_g・sodium_mg(後3つは nullable)を含む。単位は kcal/g、sodium のみ mg。q は1文字以上、limit 既定8・最大50。いつ使うか: 過去に食べたものを再記録する際に PFC を引き写す用途。複数品からなる『朝の定番』等のワンタップ記録は save_meal_preset で保存→ log_preset / get_meal_presets を使う(本ツールは単品候補)。`,
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
      description: `指定日(date 省略時は今日JST, YYYY-MM-DD)のその日の全データを1度に返す。返り値: nutrition{totals(kcal/P/F/C・fiber/sugar(g)・sodium(mg)の合算), meals(品目明細)}・workouts(その日のセッション)・body(体重/体脂肪%)・sleep(主睡眠の deep/light/rem/awake/efficiency)・sensing(RHR/HRV/SpO2/呼吸/VO2max/歩数/active_energy_kcal)。いつ使うか: 1日の総合評価やエネルギー収支(摂取 vs 消費)に。使い分け: 直近7日の集計は get_weekly_summary、コンディション信号は get_readiness、1種目の時系列は get_exercise_history。注意: 未記録/未取得の項目は null。当日指定時、sensing/sleep は Fitbit→GH ミラーで数時間遅れて欠損や暫定値になりうる(前日まではほぼ確定)。`,
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
      const workouts = await getSessionsByDate(ctx.db, d);
      // センシング(D1ミラー): RHR/HRV/SpO2/VO2max/歩数/active_energy_kcal 等。摂取(nutrition)vs 消費の収支に。
      const sensing = await getDailyMetricsByDate(ctx.db, d);
      // 睡眠サマリ(deep/light/rem/awake/efficiency)。回復分析用。旧 Fitbit MCP の get_sleep 代替。
      const sleep = await getSleepByDate(ctx.db, d);
      return ok({
        provenance: 'd1_confirmed',
        date: d,
        nutrition: { totals, meals: mealsOut },
        workouts,
        body,
        sleep,
        sensing,
      });
    },
  );
}

// ===== M2-c: write(全て @ghs/core/services 経由・§8.5。GH push 成否を ghPushed で正直に返す)=====
function registerWriteTools(server: McpServer, env: Env) {
  server.registerTool(
    'log_meal',
    {
      title: '食事を記録',
      description: `食事を D1 に記録し(正本)、可能なら Google Health(GH)へ push する。返り値は { mealId, ghPushed, clientRequestId }。ghPushed は GH 反映の真偽(栄養 push は機能フラグ依存で、OFF 時は D1 記録のみ・ghPushed=false になる。記録自体は失われない)。引数: mealType(必須・アプリ6種 Breakfast/MorningSnack/Lunch/AfternoonSnack/Dinner/Anytime。一般的な breakfast/lunch 等と混同しない)、items[](最低1品)。栄養値は呼び出し側が見積もって品目ごとに渡す: caloriesKcal は必須、proteinG/fatG/carbsG/fiberG/sugarG/sodiumMg は任意。単位は kcal・g(sodium のみ mg)。date 省略時は今日(JST)。冪等: 同じ記録の再送防止に clientRequestId を再利用(省略時はサーバ生成し返り値に含める)。既存 clientRequestId で再送すると新規作成せず既存 mealId を返す(その際 ghPushed=false)。訂正: 編集ツールは無い。誤記録は delete_recent_log で取消 → 再記録が公式フロー。写真から記録するなら log_meal_photo を使う。`,
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
      description: `ワークアウト(種目×セット)を D1 に記録し、completed なら GH へ push する。e1RM/PR/総ボリュームは core が計算。exerciseId は search_exercises で解決した id。重量種目は各セットに entryValue 必須(欠落だとエラーで弾く)、自重種目は省略可(loadMode を bodyweight、reps のみで可)。entryUnit は kg/lb。loadMode 省略時は種目マスタに従う。title 不要(主働筋の部位から自動命名、例「胸・腕」)。返り値: { sessionId, totalVolumeKg, title, ghPushed, newPrs[], clientRequestId }。ghPushed は GH 反映の真偽。newPrs は新自己ベスト{ name, recordType=e1rm, value, prevValue, unit=kg, isProvisional } — あれば普通に称えてよい。isProvisional=true は RPE 未入力で推定確度が低い(実測より低めに出る)暫定 PR で、重量の絶対値を語るときだけその旨を注に添える(祝福自体は控えめにしない)。冪等: clientRequestId を再送で再利用(省略時サーバ生成)。既存 clientRequestId の再送は新規作成せず既存 sessionId を返す(その際 totalVolumeKg=0・newPrs=[]・ghPushed=false になるため、再送結果から『PRなし』と判断しないこと)。分析は get_exercise_history(1種目の時系列)/ get_muscle_calendar・get_training_frequency(主働の分割・頻度)/ get_muscle_volume(間接含む総刺激)を併用。`,
      inputSchema: SaveWorkoutInputSchema.shape,
      annotations: WRITE_GH,
    },
    async (args) => {
      const ctx = makeContext(env);
      const input = SaveWorkoutInputSchema.parse(args);
      // §5.5-B: 重量種目のセットに entryValue が無いと総量が静かに0になる。MCP 層で弾く(web/core 非干渉)。
      const bwById = new Map<string, boolean>();
      for (const id of new Set(input.exercises.map((e) => e.exerciseId))) {
        try {
          bwById.set(id, (await resolveExercise(ctx.db, id)).is_bodyweight);
        } catch {
          /* 未解決種目は saveWorkout 側で扱う */
        }
      }
      const missing: string[] = [];
      for (const ex of input.exercises) {
        const isBw = bwById.get(ex.exerciseId) ?? false;
        ex.sets.forEach((s, i) => {
          const mode = s.loadMode ?? (isBw ? 'bodyweight' : 'weighted');
          if (mode === 'weighted' && s.entryValue == null)
            missing.push(`${ex.exerciseId} set${i + 1}`);
        });
      }
      if (missing.length) {
        return fail(
          `重量種目のセットに重量(entryValue)がありません: ${missing.join(', ')}。重量種目は entryValue 必須(自重なら loadMode:'bodyweight')。`,
        );
      }
      const clientRequestId = ensureCrid(input.clientRequestId);
      const res = await saveWorkout(ctx, { ...input, clientRequestId });
      return ok({ ...res, clientRequestId });
    },
  );

  server.registerTool(
    'log_weight',
    {
      title: '体重を記録',
      description: `体重(+任意で体脂肪%)を手入力で記録し GH へ push する(体重 push は機能フラグ非依存で常に実行)。entryUnit は kg/lb。返り値は { id, ghPushed }(ghPushed=体重 datapoint の GH 反映の真偽)。soft-guard: 同日に体重差 0.5kg 未満の既存記録があると、記録せず status が similar_exists(requireConfirm:true)と existing(weight_kg/body_fat_pct/source)を返す。別測定(朝晩など)として記録するなら confirm:true を付けて再呼び出し、単なる重複なら呼ばない。日付は date 省略時、measuredAtSec があればその JST 日付・無ければ今日(JST)。bodyFatPct は別 datapoint として独立に push される。`,
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
      description: `栄養目標を設定する(D1 のみ・GH には送らない)。AI が目標基準で食事を分析・講評するための基準値で、get_settings / get_weekly_summary / get_day の評価に使われる。引数: phase(bulk/cut/maintain)、kcal、proteinG/fatG/carbsG(g)、任意で saltG(塩分 g・省略時 6)/fiberG(食物繊維 g・省略時 20)、dateFrom。注意: saltG は『塩分のグラム』であって他ツールの sodium(ナトリウム mg)とは別単位なので混同しない。dateFrom 省略時は今日(JST)から適用。同日 dateFrom は既存目標を上書き、別日なら新しいフェーズ行を追加(履歴として残る)。返り値は { ok:true }。`,
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
      description: `保存済みの食事プリセットを返す(D1のみ・GH無関係)。各プリセットは id / name / default_meal_type(アプリ内6種: Breakfast/MorningSnack/Lunch/AfternoonSnack/Dinner/Anytime)/ use_count / items[](1 serving 基準の栄養値)。並び順は使用回数の多い順(同数なら更新が新しい順)。いつ使うか: log_preset で記録する前に presetId を解決する起点。返ってきた id を log_preset の presetId に渡し、servings 倍率で按分記録する(例: 30g 登録のプリセットを 40g 記録 → servings=1.3333)。入力なし。`,
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
      description: `よく食べる構成を再利用用プリセットとして保存する(D1ローカルのみ・GHには書かない・use_count は0始まり)。返り値は { presetId }。注意: これは保存だけで食事の記録にはならない — 実際に記録するのは log_preset。栄養値は必ず『1 serving 分』で登録する(例: WPI 30g を 1 serving として登録 → 後で log_preset の servings=1.3333 で 40g 相当を記録できる)。単位は kcal / g、sodium のみ mg。defaultMealType はアプリ内6種(Breakfast/MorningSnack/Lunch/AfternoonSnack/Dinner/Anytime)から指定し、log_preset で mealType 省略時の既定になる。`,
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
      description: `プリセット(presetId)から食事を1件記録し、GHへ best-effort で push する。返り値は { mealId, ghPushed, clientRequestId }。ghPushed は GH へ反映できたかの真偽(機能フラグOFFや一時失敗時は false でも D1 正本には記録済み)。servings 倍率で各 item の全栄養素と quantity を按分し、結果は0.1単位に丸める(例: 30g 登録のプリセットで 40g 記録 → servings=1.3333)。省略時 servings=1。mealType 省略時はプリセットの default_meal_type。date は JST の YYYY-MM-DD、省略時は当日。clientRequestId は冪等キー: 同一値で再送すると新規記録せず既存の mealId を返す(ghPushed:false)。省略時はサーバ生成し返却。記録内容の訂正に編集機能は無く、delete_recent_log で取消→再記録が公式フロー。`,
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
    'delete_meal_preset',
    {
      title: '食事プリセットを削除',
      description: `保存済みプリセットを削除する(D1のみ・GH無関係)。echo+confirm の二段: confirm 省略時は削除せず対象 { id, name } を echo するので、内容を確認のうえ confirm:true で実行する(成功時 { deleted:true })。presetId が見つからない場合は error が not_found。既に記録済みの食事には一切影響しない(プリセット定義のみ消す)。`,
      inputSchema: { presetId: z.string().min(1), confirm: z.boolean().optional() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ presetId, confirm }) => {
      const ctx = makeContext(env);
      const preset = (await listMealPresets(ctx.db)).find((p) => p.id === presetId);
      if (!preset) return ok({ error: 'not_found', message: 'プリセットが見つかりません' });
      if (!confirm) {
        return ok({
          requireConfirm: true,
          target: { id: preset.id, name: preset.name },
          message: `プリセット「${preset.name}」を削除します。confirm:true で実行。`,
        });
      }
      await deleteMealPresetRow(ctx.db, presetId);
      return ok({ deleted: true });
    },
  );

  server.registerTool(
    'log_meal_photo',
    {
      title: '写真から食事を記録',
      description: `食事写真を**あなた(Claude)が視覚解析**して栄養値(kcal/PFC 等)を見積もり、items[] に変換して記録する。画像バイナリは渡さない(解析済みの items[] のみ渡す契約)。inputMethod はサーバ側で photo に固定される(他値を渡しても無視)。それ以外は log_meal と同契約。mealType は必須(アプリ6種 Breakfast/MorningSnack/Lunch/AfternoonSnack/Dinner/Anytime)。栄養は品目ごとに caloriesKcal 必須・PFC/繊維/糖/Na 任意、単位は kcal・g(sodium のみ mg)。返り値は { mealId, ghPushed, clientRequestId }。ghPushed は GH 反映の真偽(栄養 push は機能フラグ依存で OFF 時は D1 のみ・ghPushed=false)。冪等は clientRequestId を再利用(省略時サーバ生成)。訂正は delete_recent_log で取消 → 再記録。`,
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
}

// ===== M2-d: destructive(直近の取消のみ。echo+confirm 二段, §5.5-D/E・§6.4)=====
function registerDestructiveTools(server: McpServer, env: Env) {
  server.registerTool(
    'delete_recent_log',
    {
      title: '直近の記録を取消',
      description: `直近の食事 / ワークアウト / 体重を取消す(D1から削除し、GH datapoint も best-effort で削除)。返り値は { deleted, ghDeleted }: ghDeleted は GH 側 datapoint を消せたかの真偽で、false でも D1 正本は削除済み。echo+confirm 二段: confirm 省略時は削除せず対象内容を echo するので、確認して confirm:true で実行する。取消可能範囲(JST基準)— 食事/体重は当日または前日まで、ワークアウトは当日または直近3セッションまで。範囲外は error が not_recent。対象 id は事前に取得すること(食事・体重は get_day、ワークアウトは get_recent_sessions)。重要: 記録の編集ツールは存在しないため、内容を直す唯一の公式フローは『この取消 → 正しい内容で再記録』。`,
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
}

// ===== トレーニングルーティン(AI作成・参照専用ライブラリ。CRUD, §8.10)=====
function registerRoutineTools(server: McpServer, env: Env) {
  server.registerTool(
    'get_routines',
    {
      title: 'ルーティン一覧',
      description:
        '保存済みのトレーニングルーティン(計画メニュー)一覧を返す。各行は id / name / goal(目標副題) / is_active(現在運用中か) / day_count(日数) / updated_at。詳細は get_routine。これは「計画の参照」であり実績ログ(get_recent_sessions 等)とは別物。',
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      const ctx = makeContext(env);
      return ok({ provenance: 'd1_confirmed', routines: await getRoutines(ctx.db) });
    },
  );

  server.registerTool(
    'get_routine',
    {
      title: 'ルーティン詳細',
      description:
        '1件のルーティンの全詳細を返す。days[]={ position, label, title(例「胸(強化)+三頭」), aim(狙い), main_lift, is_rest, note, exercises[]={ exercise_id, exercise_name, alt_exercise_name(「X or Y」の代替), sets_min/sets_max, reps_min/reps_max, target_load(任意), note }, muscles[]=その日の部位別 intensity(人体図用・間接含む) }。編集前に読んで save_routine で全置換するのが基本フロー。',
      inputSchema: { id: z.string().min(1) },
      annotations: READ,
    },
    async ({ id }) => {
      const ctx = makeContext(env);
      const r = await getRoutine(ctx.db, id);
      if (!r) return ok({ error: 'not_found', message: 'ルーティンが見つかりません' });
      return ok({ provenance: 'd1_confirmed', ...r });
    },
  );

  server.registerTool(
    'save_routine',
    {
      title: 'ルーティンを保存',
      description:
        'トレーニングルーティン(計画)を保存する。**id 省略=新規追加 / id 指定=その id を全置換(編集)**。日(カテゴリ単位)と種目をネストで一括で渡す。種目は必ずカタログの exerciseId(search_exercises で解決した id。名前でも内部解決するが曖昧/未存在なら unresolved_exercises を返すので id で再送)。荷重(targetLoad)は任意。セット/レップは setsMin/setsMax・repsMin/repsMax の範囲(例 4-5セット → setsMin:4,setsMax:5)。レスト日は isRest:true で exercises 不要。isActive:true で現在運用中にする(他は自動で解除)。notes に方針・漸進性過負荷・デロード等の運用ルールをプレーンテキストで。返り値 { id }。',
      inputSchema: {
        id: z.string().optional(),
        name: z.string().min(1).max(120),
        goal: z.string().max(300).optional(),
        notes: z.string().max(8000).optional(),
        isActive: z.boolean().optional(),
        days: z
          .array(
            z.object({
              label: z.string().max(40).optional(),
              title: z.string().min(1).max(120),
              aim: z.string().max(300).optional(),
              mainLift: z.string().max(120).optional(),
              isRest: z.boolean().optional(),
              note: z.string().max(2000).optional(),
              exercises: z
                .array(
                  z.object({
                    exerciseId: z.string().min(1),
                    altExerciseId: z.string().optional(),
                    setsMin: z.number().int().min(1).max(30).optional(),
                    setsMax: z.number().int().min(1).max(30).optional(),
                    repsMin: z.number().int().min(1).max(100).optional(),
                    repsMax: z.number().int().min(1).max(100).optional(),
                    targetLoad: z.string().max(40).optional(),
                    note: z.string().max(500).optional(),
                  }),
                )
                .max(30)
                .optional(),
            }),
          )
          .min(1)
          .max(14),
      },
      annotations: WRITE_LOCAL,
    },
    async (input) => {
      const ctx = makeContext(env);
      // 全 exerciseId / altExerciseId をカタログ id に解決(自由入力を弾く)。
      const raws = new Set<string>();
      for (const d of input.days)
        for (const e of d.exercises ?? []) {
          raws.add(e.exerciseId);
          if (e.altExerciseId) raws.add(e.altExerciseId);
        }
      // 実在 id は1クエリで一括判定し、残り(名前/エイリアス)だけ個別解決(N+1回避)。
      const rawList = [...raws];
      const existing = await getExistingExerciseIds(ctx.db, rawList);
      const resolved = new Map<string, string>();
      const unresolved: Array<{ input: string; candidates: unknown }> = [];
      for (const raw of rawList) {
        if (existing.has(raw)) {
          resolved.set(raw, raw);
          continue;
        }
        const r = await resolveExerciseId(ctx.db, raw);
        if ('id' in r) resolved.set(raw, r.id);
        else unresolved.push({ input: raw, candidates: r.candidates });
      }
      if (unresolved.length) {
        return ok({
          error: 'unresolved_exercises',
          unresolved,
          hint: 'search_exercises で id を解決し、exerciseId にその id を渡して再送してください(自由入力は不可)。',
        });
      }
      const payload: SaveRoutineInput = {
        id: input.id,
        name: input.name,
        goal: input.goal,
        notes: input.notes,
        isActive: input.isActive,
        days: input.days.map((d) => ({
          label: d.label,
          title: d.title,
          aim: d.aim,
          mainLift: d.mainLift,
          isRest: d.isRest,
          note: d.note,
          exercises: (d.exercises ?? []).map((e) => ({
            exerciseId: resolved.get(e.exerciseId) ?? e.exerciseId,
            altExerciseId: e.altExerciseId ? resolved.get(e.altExerciseId) : undefined,
            setsMin: e.setsMin,
            setsMax: e.setsMax,
            repsMin: e.repsMin,
            repsMax: e.repsMax,
            targetLoad: e.targetLoad,
            note: e.note,
          })),
        })),
      };
      return ok(await saveRoutine(ctx.db, payload));
    },
  );

  server.registerTool(
    'delete_routine',
    {
      title: 'ルーティンを削除',
      description:
        'ルーティンを削除する(D1のみ・GH無関係・実績ログには影響しない)。echo+confirm 二段: confirm 省略時は対象 { id, name } を echo するので確認して confirm:true で実行。',
      inputSchema: { id: z.string().min(1), confirm: z.boolean().optional() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, confirm }) => {
      const ctx = makeContext(env);
      const r = await getRoutine(ctx.db, id);
      if (!r) return ok({ error: 'not_found', message: 'ルーティンが見つかりません' });
      if (!confirm) {
        return ok({
          requireConfirm: true,
          target: { id: r.id, name: r.name, days: r.days.length },
          message: `ルーティン「${r.name}」(${r.days.length}日)を削除します。confirm:true で実行。`,
        });
      }
      return ok(await deleteRoutine(ctx.db, id));
    },
  );
}

// buildServer が順に呼ぶ登録関数(機能群ごと)。呼び忘れ=ツール消失を index.test.ts の contract で防ぐ。
export const REGISTRARS = [
  registerReadTools,
  registerWriteTools,
  registerDestructiveTools,
  registerRoutineTools,
];

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

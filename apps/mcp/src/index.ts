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
  getActiveNutritionTarget,
  getBodyForDate,
  getExerciseHistory,
  getMealItemsForMeals,
  getMealsByDate,
  getMuscleCalendar,
  getMuscleVolume,
  getRecentPrs,
  getRecentSessions,
  getSettings,
  makeContext,
  resolveExercise,
  searchExercises,
  todayJst,
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

/** リクエスト毎に McpServer を新規生成(ステートレス)。M2-a: get_settings / M2-b: read 群。 */
function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: 'logbook-mcp', version: '0.2.0' });

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
      const sets = await getExerciseHistory(ctx, r.id, { since, limit });
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

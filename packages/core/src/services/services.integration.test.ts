import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runBatch } from '../db/batch-helpers';
import { Db } from '../db/client';
import { ulid } from '../db/ids';
import { searchExercises } from '../db/repositories/exercises';
import {
  getPendingPushes,
  markPushDeferred,
  markPushFailed,
  markPushSynced,
  PUSH_MAX_RETRIES,
  pendingPushStmt,
} from '../db/repositories/sync';
import type {
  BodyPushInput,
  ExercisePushInput,
  HealthProvider,
  NutritionPushInput,
  ProviderDataPoint,
  ReconcileResult,
} from '../providers/HealthProvider';
import { todayJst } from '../util/date';
import { deleteBodyMetric, logWeight } from './body';
import type { AppContext } from './context';
import { deleteMeal, logMeal, logMealFromPreset, saveMealPreset } from './nutrition';
import { pullActiveEnergyDaily, retryPendingPushes, runDailyPull } from './sync';
import {
  getExerciseHistory,
  getMuscleCalendar,
  getMuscleVolume,
  getTrainingFrequency,
  saveWorkout,
} from './workout';

/** テスト用 fake provider: push 呼び出しを記録し、reconcile はタイプ別の固定点を返す。 */
class FakeProvider implements HealthProvider {
  nutritionCalls: NutritionPushInput[] = [];
  bodyCalls: BodyPushInput[] = [];
  exerciseCalls: ExercisePushInput[] = [];
  deleteCalls: Array<{ type: string; ids: string[] }> = [];
  constructor(
    private opts: {
      pointsByType?: Record<string, ProviderDataPoint[]>;
      failBodyFat?: boolean;
      failNutrition?: boolean;
    } = {},
  ) {}
  async reconcileDataPoints(ghDataType: string): Promise<ReconcileResult> {
    return { points: this.opts.pointsByType?.[ghDataType] ?? [], cursor: null };
  }
  async pushExercise(input: ExercisePushInput) {
    this.exerciseCalls.push(input);
    return { datapointId: `ex-${input.clientTag}`, dataOrigin: 'logbook' };
  }
  async pushNutrition(input: NutritionPushInput) {
    if (this.opts.failNutrition) throw new Error('nutrition push failed');
    this.nutritionCalls.push(input);
    return { datapointId: `nut-${input.clientTag}`, dataOrigin: 'logbook' };
  }
  async pushBodyMetric(input: BodyPushInput) {
    if (this.opts.failBodyFat && input.kind === 'body-fat') throw new Error('body-fat push failed');
    this.bodyCalls.push(input);
    return { datapointId: `${input.kind}-${input.clientTag}`, dataOrigin: 'logbook' };
  }
  async batchDelete(ghDataType: string, ids: string[]) {
    this.deleteCalls.push({ type: ghDataType, ids });
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '../db/migrations');

/** better-sqlite3 を D1Database 互換に薄くラップ(テスト専用)。prepare→bind→first/all/run + batch。 */
function fakeD1(sqlite: Database.Database): D1Database {
  const norm = (b: unknown) => (b === undefined ? null : typeof b === 'boolean' ? (b ? 1 : 0) : b);
  const makeStmt = (sql: string, binds: unknown[] = []) => ({
    sql,
    binds,
    bind(...b: unknown[]) {
      return makeStmt(sql, b.map(norm));
    },
    first<T>() {
      return (sqlite.prepare(sql).get(...this.binds) ?? null) as T | null;
    },
    all<T>() {
      return { results: sqlite.prepare(sql).all(...this.binds) as T[], success: true, meta: {} };
    },
    run() {
      const r = sqlite.prepare(sql).run(...this.binds);
      return { success: true, results: [], meta: { changes: r.changes, duration: 0 } };
    },
    raw() {
      return sqlite
        .prepare(sql)
        .raw()
        .all(...this.binds);
    },
  });
  return {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    batch: async (stmts: D1PreparedStatement[]) => {
      const tx = sqlite.transaction((ss: Array<{ run: () => unknown }>) => ss.map((s) => s.run()));
      return tx(stmts as unknown as Array<{ run: () => unknown }>) as D1Result[];
    },
  } as unknown as D1Database;
}

function makeTestDb(): Db {
  const sqlite = new Database(':memory:');
  for (const f of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  sqlite.pragma('foreign_keys = ON'); // D1 と同様に CASCADE/FK を有効化
  return new Db(fakeD1(sqlite));
}

function makeCtx(over: Partial<AppContext> = {}): AppContext {
  return {
    db: makeTestDb(),
    tokens: {} as KVNamespace,
    lock: {} as KVNamespace,
    oauth: { clientId: '', clientSecret: '' },
    featureGhNutritionPush: false, // GH push は無効(D1 のみ検証)
    pushInline: false,
    ...over,
  };
}

describe('logMeal', () => {
  it('同じ clientRequestId なら二重登録しない(冪等)', async () => {
    const ctx = makeCtx();
    const input = {
      mealType: 'Breakfast' as const,
      items: [{ foodName: '卵', caloriesKcal: 80, proteinG: 7 }],
      clientRequestId: 'idem-1',
    };
    const r1 = await logMeal(ctx, input);
    const r2 = await logMeal(ctx, input);
    expect(r2.mealId).toBe(r1.mealId);
    const rows = await ctx.db.raw<{ n: number }>('SELECT count(*) AS n FROM meals');
    expect(rows[0]?.n).toBe(1);
  });

  it('presetId 指定で input_method=preset / meal_items.preset_id が入る', async () => {
    const ctx = makeCtx();
    const { presetId } = await saveMealPreset(ctx, {
      name: '朝の定番',
      defaultMealType: 'Breakfast',
      items: [{ foodName: '卵', caloriesKcal: 80 }],
    });
    const r = await logMeal(ctx, {
      mealType: 'Breakfast',
      items: [{ foodName: '卵', caloriesKcal: 80 }],
      presetId,
    });
    const [meal] = await ctx.db.raw<{ input_method: string }>(
      'SELECT input_method FROM meals WHERE id = ?',
      r.mealId,
    );
    expect(meal?.input_method).toBe('preset');
    const [item] = await ctx.db.raw<{ preset_id: string | null }>(
      'SELECT preset_id FROM meal_items WHERE meal_id = ?',
      r.mealId,
    );
    expect(item?.preset_id).toBe(presetId);
  });

  it('meal + items + 台帳を1 batch で原子的に書く', async () => {
    const ctx = makeCtx();
    const r = await logMeal(ctx, {
      mealType: 'Lunch',
      items: [
        { foodName: '鶏胸肉', caloriesKcal: 165 },
        { foodName: '白米', caloriesKcal: 250 },
      ],
    });
    const rows = await ctx.db.raw<{ n: number }>(
      'SELECT count(*) AS n FROM meal_items WHERE meal_id = ?',
      r.mealId,
    );
    expect(rows[0]?.n).toBe(2);
  });
});

describe('deleteMeal', () => {
  it('meal / meal_items(CASCADE) / 台帳を原子的に削除する', async () => {
    const ctx = makeCtx();
    const r = await logMeal(ctx, {
      mealType: 'Dinner',
      items: [{ foodName: 'サーモン', caloriesKcal: 200 }],
    });
    await deleteMeal(ctx, r.mealId);
    const count = async (sql: string) => (await ctx.db.raw<{ n: number }>(sql, r.mealId))[0]?.n;
    expect(await count('SELECT count(*) AS n FROM meals WHERE id = ?')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM meal_items WHERE meal_id = ?')).toBe(0);
    expect(
      await count(
        "SELECT count(*) AS n FROM gh_sync_state WHERE entity_type='meal' AND entity_id=?",
      ),
    ).toBe(0);
  });
});

describe('saveWorkout', () => {
  it('同じ clientRequestId なら二重登録しない(冪等)', async () => {
    const ctx = makeCtx();
    const input = {
      exercises: [
        {
          exerciseId: 'dumbbell-bench-press',
          sets: [{ setType: 'main' as const, entryValue: 20, reps: 10, entryUnit: 'kg' as const }],
        },
      ],
      clientRequestId: 'w-idem-1',
    };
    const r1 = await saveWorkout(ctx, input);
    const r2 = await saveWorkout(ctx, input);
    expect(r2.sessionId).toBe(r1.sessionId);
    const rows = await ctx.db.raw<{ n: number }>('SELECT count(*) AS n FROM workout_sessions');
    expect(rows[0]?.n).toBe(1);
  });

  it('セッション名を主働筋の部位から自動命名する(手入力なし)', async () => {
    const ctx = makeCtx();
    const r = await saveWorkout(ctx, {
      exercises: [
        {
          exerciseId: 'dumbbell-bench-press', // primary=chest のみ(front_delts/triceps は secondary)
          sets: [{ setType: 'main' as const, entryValue: 30, reps: 10, entryUnit: 'kg' as const }],
        },
      ],
    });
    const [s] = await ctx.db.raw<{ title: string | null }>(
      'SELECT title FROM workout_sessions WHERE id = ?',
      r.sessionId,
    );
    expect(s?.title).toBe('胸');
  });

  it('明示 title があれば自動命名より優先する', async () => {
    const ctx = makeCtx();
    const r = await saveWorkout(ctx, {
      title: 'PR Day',
      exercises: [
        {
          exerciseId: 'dumbbell-bench-press',
          sets: [{ setType: 'main' as const, entryValue: 30, reps: 10, entryUnit: 'kg' as const }],
        },
      ],
    });
    const [s] = await ctx.db.raw<{ title: string | null }>(
      'SELECT title FROM workout_sessions WHERE id = ?',
      r.sessionId,
    );
    expect(s?.title).toBe('PR Day');
  });
});

describe('push dead-letter (§12.2)', () => {
  let ctx: AppContext;
  beforeEach(() => {
    ctx = makeCtx();
  });

  it('retry_count が上限到達で dead_letter に隔離され、再試行対象から外れる', async () => {
    const id = ulid();
    await runBatch(ctx.db, [pendingPushStmt('meal', id)]);
    for (let i = 0; i < PUSH_MAX_RETRIES; i++) {
      await markPushFailed(ctx.db, 'meal', id, 'boom');
    }
    const [row] = await ctx.db.raw<{ sync_status: string; retry_count: number }>(
      'SELECT sync_status, retry_count FROM gh_sync_state WHERE entity_id = ?',
      id,
    );
    expect(row?.sync_status).toBe('dead_letter');
    expect(row?.retry_count).toBe(PUSH_MAX_RETRIES);
    const pending = await getPendingPushes(ctx.db);
    expect(pending.some((p) => p.entity_id === id)).toBe(false);
  });

  it('permanent=true(403相当)は1回で即 dead_letter', async () => {
    const id = ulid();
    await runBatch(ctx.db, [pendingPushStmt('meal', id)]);
    await markPushFailed(ctx.db, 'meal', id, 'forbidden', { permanent: true });
    const [row] = await ctx.db.raw<{ sync_status: string; retry_count: number }>(
      'SELECT sync_status, retry_count FROM gh_sync_state WHERE entity_id = ?',
      id,
    );
    expect(row?.sync_status).toBe('dead_letter');
    expect(row?.retry_count).toBe(1);
  });

  it('markPushDeferred は retry_count を消費せず next_retry_at を未来に置く', async () => {
    const id = ulid();
    await runBatch(ctx.db, [pendingPushStmt('meal', id)]);
    await markPushDeferred(ctx.db, 'meal', id, 3600);
    const [row] = await ctx.db.raw<{
      sync_status: string;
      retry_count: number;
      next_retry_at: number;
    }>('SELECT sync_status, retry_count, next_retry_at FROM gh_sync_state WHERE entity_id = ?', id);
    expect(row?.sync_status).toBe('pending'); // ステータス据え置き
    expect(row?.retry_count).toBe(0); // dead_letter に近づけない
    expect(row?.next_retry_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // バックオフ中は再試行対象から外れる
    const pending = await getPendingPushes(ctx.db);
    expect(pending.some((p) => p.entity_id === id)).toBe(false);
  });

  it('1回失敗(soft)は failed + next_retry_at が付与され、即時には拾われない', async () => {
    const id = ulid();
    await runBatch(ctx.db, [pendingPushStmt('meal', id)]);
    await markPushFailed(ctx.db, 'meal', id, 'transient');
    const [row] = await ctx.db.raw<{ sync_status: string; next_retry_at: number | null }>(
      'SELECT sync_status, next_retry_at FROM gh_sync_state WHERE entity_id = ?',
      id,
    );
    expect(row?.sync_status).toBe('failed');
    expect(row?.next_retry_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe('logWeight (§2.1)', () => {
  it('体重+体脂肪を D1(source=app)に保存し、両方を GH push して台帳を synced にする', async () => {
    const provider = new FakeProvider();
    const ctx = makeCtx({ provider, pushInline: true });
    const r = await logWeight(ctx, { entryValue: 75, entryUnit: 'kg', bodyFatPct: 15 });
    expect(r.ghPushed).toBe(true);
    const [row] = await ctx.db.raw<{ weight_kg: number; body_fat_pct: number; source: string }>(
      'SELECT weight_kg, body_fat_pct, source FROM body_metrics WHERE id = ?',
      r.id,
    );
    expect(row?.weight_kg).toBe(75);
    expect(row?.body_fat_pct).toBe(15);
    expect(row?.source).toBe('app');
    // weight + body-fat を別 datapoint として push
    expect(provider.bodyCalls.map((c) => c.kind).sort()).toEqual(['body-fat', 'weight']);
    const states = await ctx.db.raw<{ sync_status: string }>(
      'SELECT sync_status FROM gh_sync_state WHERE entity_id = ?',
      r.id,
    );
    expect(states.length).toBe(2);
    expect(states.every((s) => s.sync_status === 'synced')).toBe(true);
  });

  it('lb 入力は kg に正規化して保存する', async () => {
    const ctx = makeCtx({ provider: new FakeProvider(), pushInline: true });
    const r = await logWeight(ctx, { entryValue: 220, entryUnit: 'lb' });
    const [row] = await ctx.db.raw<{ weight_kg: number }>(
      'SELECT weight_kg FROM body_metrics WHERE id = ?',
      r.id,
    );
    expect(Math.round(row?.weight_kg ?? 0)).toBe(100); // 220lb ≈ 99.79kg
  });

  it('体脂肪 push 失敗でも体重は synced を維持する(独立 try/catch のリグレッション防止)', async () => {
    const ctx = makeCtx({ provider: new FakeProvider({ failBodyFat: true }), pushInline: true });
    const r = await logWeight(ctx, { entryValue: 75, entryUnit: 'kg', bodyFatPct: 15 });
    const states = await ctx.db.raw<{ entity_type: string; sync_status: string }>(
      'SELECT entity_type, sync_status FROM gh_sync_state WHERE entity_id = ?',
      r.id,
    );
    const byType = Object.fromEntries(states.map((s) => [s.entity_type, s.sync_status]));
    expect(byType.body_metric).toBe('synced');
    expect(byType.body_metric_fat).toBe('failed');
  });
});

describe('runDailyPull (§5.4)', () => {
  it('own-write(自分の push と一致する datapoint)は取り込まない(echoループ防止)', async () => {
    const ctx = makeCtx();
    // 自分の体重 push を台帳に synced で記録(gh_datapoint_id=own-dp)。
    const ownId = ulid();
    await runBatch(ctx.db, [pendingPushStmt('body_metric', ownId)]);
    await markPushSynced(ctx.db, 'body_metric', ownId, 'own-dp', 'logbook', null);
    ctx.provider = new FakeProvider({
      pointsByType: {
        weight: [
          { id: 'own-dp', timeSec: 1_750_000_000, value: 80 }, // 自分の push → skip
          { id: 'foreign-dp', timeSec: 1_750_000_100, value: 72 }, // デバイス測定 → 取込
        ],
      },
    });
    const res = await runDailyPull(ctx);
    expect(res.errors).toEqual([]);
    const rows = await ctx.db.raw<{ gh_external_id: string }>(
      'SELECT gh_external_id FROM body_metrics ORDER BY gh_external_id',
    );
    expect(rows.map((r) => r.gh_external_id)).toEqual(['foreign-dp']);
  });

  it('weight / daily-metric / sleep を JST 日付で storage に upsert する', async () => {
    const ctx = makeCtx({
      provider: new FakeProvider({
        pointsByType: {
          weight: [{ id: 'w1', timeSec: 1_750_000_000, value: 70.5 }],
          'daily-resting-heart-rate': [{ id: 'rhr1', timeSec: 1_750_000_000, value: 52 }],
          sleep: [
            {
              id: 's1',
              timeSec: 1_750_000_000,
              value: null,
              extra: {
                start_sec: 1_750_000_000,
                end_sec: 1_750_025_200,
                total_min: 420,
                deep_min: 90,
                light_min: 240,
                rem_min: 90,
                awake_min: 20,
                efficiency: 92,
              },
            },
          ],
        },
      }),
    });
    const res = await runDailyPull(ctx);
    expect(res.errors).toEqual([]);
    const n = async (sql: string) => (await ctx.db.raw<{ n: number }>(sql))[0]?.n;
    expect(await n("SELECT count(*) AS n FROM body_metrics WHERE gh_external_id='w1'")).toBe(1);
    expect(await n("SELECT count(*) AS n FROM daily_metrics WHERE metric='resting_hr'")).toBe(1);
    const [sleep] = await ctx.db.raw<{ total_min: number; efficiency: number }>(
      "SELECT total_min, efficiency FROM sleep_logs WHERE gh_external_id='s1'",
    );
    expect(sleep?.total_min).toBe(420);
    expect(sleep?.efficiency).toBe(92);
  });
});

describe('GH push 栄養忠実度(fiber/sugar/sodium)', () => {
  it('logMeal 初回 push で fiber/sugar/sodium を合算して pushNutrition に渡す', async () => {
    const provider = new FakeProvider();
    const ctx = makeCtx({ provider, featureGhNutritionPush: true, pushInline: true });
    await logMeal(ctx, {
      mealType: 'Breakfast',
      items: [
        { foodName: 'A', caloriesKcal: 200, fiberG: 3, sugarG: 5, sodiumMg: 400 },
        { foodName: 'B', caloriesKcal: 100, fiberG: 2, sugarG: 1, sodiumMg: 100 },
      ],
    });
    expect(provider.nutritionCalls.length).toBe(1);
    const call = provider.nutritionCalls[0]!;
    expect(call.fiberG).toBe(5);
    expect(call.sugarG).toBe(6);
    expect(call.sodiumMg).toBe(500);
  });

  it('retryPendingPushes(再送)も fiber/sugar/sodium を含めて pushNutrition する', async () => {
    const provider = new FakeProvider();
    const ctx = makeCtx({ provider, featureGhNutritionPush: true, pushInline: false });
    // flag on + pushInline false → ledger は pending のまま(初回 push せず)→ 再送対象。
    await logMeal(ctx, {
      mealType: 'Lunch',
      items: [
        {
          foodName: '定食',
          caloriesKcal: 600,
          proteinG: 40,
          fatG: 20,
          carbsG: 60,
          fiberG: 8,
          sugarG: 12,
          sodiumMg: 1500,
        },
      ],
    });
    expect(provider.nutritionCalls.length).toBe(0); // 初回はまだ push していない
    const r = await retryPendingPushes(ctx);
    expect(r.synced).toBe(1);
    expect(provider.nutritionCalls.length).toBe(1);
    const call = provider.nutritionCalls[0]!;
    expect(call.fiberG).toBe(8);
    expect(call.sugarG).toBe(12);
    expect(call.sodiumMg).toBe(1500);
  });
});

describe('分析(volume / calendar / history)', () => {
  const seedBench = (ctx: AppContext) =>
    saveWorkout(ctx, {
      exercises: [
        {
          exerciseId: 'dumbbell-bench-press',
          sets: [
            { setType: 'warmup', entryValue: 10, reps: 10, entryUnit: 'kg' },
            { setType: 'main', entryValue: 30, reps: 10, entryUnit: 'kg' },
            { setType: 'main', entryValue: 30, reps: 8, entryUnit: 'kg' },
            { setType: 'main', entryValue: 30, reps: 6, entryUnit: 'kg' },
          ],
        },
      ],
    });

  it('getMuscleVolume: 主働筋 chest の actual_sets を集計(warmup 除外)', async () => {
    const ctx = makeCtx();
    await seedBench(ctx);
    const mv = await getMuscleVolume(ctx, { windowDays: 7 });
    expect(mv.find((m) => m.muscle === 'chest')?.actual_sets).toBe(3);
  });

  it('getMuscleCalendar: 当日に chest セルが立ち、補助筋 triceps は帰属しない', async () => {
    const ctx = makeCtx();
    await seedBench(ctx);
    const cal = await getMuscleCalendar(ctx, { days: 30 });
    const today = todayJst();
    expect(cal.sessionDates).toContain(today);
    expect(cal.cells.find((c) => c.muscle === 'chest' && c.date === today)?.sets).toBe(3);
    // ベンチの triceps は secondary → 「何の日か」を曖昧にしないため帰属しない。
    expect(cal.cells.some((c) => c.muscle === 'triceps')).toBe(false);
  });

  it('getExerciseHistory: e1RM 等を計算済みのセットで返す', async () => {
    const ctx = makeCtx();
    await seedBench(ctx);
    const sets = await getExerciseHistory(ctx, 'dumbbell-bench-press', { limit: 50 });
    const mains = sets.filter((s) => s.set_type === 'main');
    expect(mains.length).toBe(3);
    expect(mains[0]?.e1rm_kg ?? 0).toBeGreaterThan(30);
  });

  it('getTrainingFrequency: 胸の最終実施日/週次、未実施部位は null/0', async () => {
    const ctx = makeCtx();
    await seedBench(ctx); // dumbbell-bench-press(chest primary)
    const freq = await getTrainingFrequency(ctx, { weeks: 4 });
    const chest = freq.find((r) => r.region === '胸');
    expect(chest?.last_trained_date).toBe(todayJst());
    expect(chest?.days_since).toBe(0);
    expect(chest?.weekly_counts[0]).toBe(1);
    expect(chest?.total_sets).toBe(3); // main 3本(warmup 除外)
    const legs = freq.find((r) => r.region === '脚');
    expect(legs?.last_trained_date).toBeNull();
    expect(legs?.weekly_counts).toEqual([0, 0, 0, 0]);
    expect(legs?.total_sets).toBe(0);
  });
});

describe('プリセット按分(logMealFromPreset)', () => {
  it('servings 倍率で全栄養素をスケールして記録する(WPI 30g→40g = 1.3333)', async () => {
    const ctx = makeCtx();
    const { presetId } = await saveMealPreset(ctx, {
      name: 'WPI 30g',
      defaultMealType: 'Anytime',
      items: [{ foodName: 'WPI', caloriesKcal: 113, proteinG: 27, fatG: 0.6, carbsG: 1.8 }],
    });
    const r = await logMealFromPreset(ctx, { presetId, servings: 1.3333, mealType: 'Anytime' });
    const [item] = await ctx.db.raw<{ calories_kcal: number; protein_g: number; quantity: number }>(
      'SELECT calories_kcal, protein_g, quantity FROM meal_items WHERE meal_id = ?',
      r.mealId,
    );
    expect(item?.calories_kcal).toBe(150.7); // 113 × 1.3333 = 150.66 → 0.1丸め
    expect(item?.protein_g).toBe(36); // 27 × 1.3333 = 35.999 → 36.0
    const [meal] = await ctx.db.raw<{ input_method: string }>(
      'SELECT input_method FROM meals WHERE id = ?',
      r.mealId,
    );
    expect(meal?.input_method).toBe('preset');
  });

  it('存在しない presetId は DomainError', async () => {
    const ctx = makeCtx();
    await expect(logMealFromPreset(ctx, { presetId: 'nope' })).rejects.toThrow();
  });
});

describe('体重の取消(deleteBodyMetric)', () => {
  it('D1 行と台帳を削除し、GH datapoint も best-effort 削除する', async () => {
    const provider = new FakeProvider();
    const ctx = makeCtx({ provider, pushInline: true });
    const { id } = await logWeight(ctx, { entryValue: 71.6, entryUnit: 'kg' });
    const res = await deleteBodyMetric(ctx, id);
    expect(res.deleted).toBe(true);
    expect(res.ghDeleted).toBe(true); // synced 済 datapoint を batchDelete
    expect(provider.deleteCalls.some((c) => c.type === 'weight')).toBe(true);
    const n = async (sql: string) => (await ctx.db.raw<{ n: number }>(sql, id))[0]?.n;
    expect(await n('SELECT count(*) AS n FROM body_metrics WHERE id = ?')).toBe(0);
    expect(await n('SELECT count(*) AS n FROM gh_sync_state WHERE entity_id = ?')).toBe(0);
  });
});

describe('種目エイリアス検索(searchExercises alias)', () => {
  it('名前に無い略称(OHP)でも alias 経由でヒットする', async () => {
    const ctx = makeCtx();
    const rows = await searchExercises(ctx.db, { query: 'OHP' });
    expect(rows.some((e) => e.id === 'overhead-press')).toBe(true);
  });
});

describe('消費カロリー日次集計(pullActiveEnergyDaily)', () => {
  it('分単位 kcal を JST 日付で合算して daily_metric(active_energy_kcal) に格納', async () => {
    const ctx = makeCtx({
      provider: new FakeProvider({
        pointsByType: {
          'active-energy-burned': [
            { id: 'a', timeSec: 1_750_000_000, value: 5 },
            { id: 'b', timeSec: 1_750_000_060, value: 7 },
            { id: 'c', timeSec: 1_750_000_120, value: 3 },
          ],
        },
      }),
    });
    const r = await pullActiveEnergyDaily(ctx, { days: 7 });
    expect(r.dates).toBe(1); // 同一 JST 日に合算
    const [m] = await ctx.db.raw<{ value: number; unit: string }>(
      "SELECT value, unit FROM daily_metrics WHERE metric='active_energy_kcal'",
    );
    expect(m?.value).toBe(15); // 5+7+3
    expect(m?.unit).toBe('kcal');
  });
});

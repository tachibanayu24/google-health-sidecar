import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { runBatch } from '../db/batch-helpers';
import { Db } from '../db/client';
import { ulid } from '../db/ids';
import {
  getPendingPushes,
  markPushDeferred,
  markPushFailed,
  PUSH_MAX_RETRIES,
  pendingPushStmt,
} from '../db/repositories/sync';
import type { AppContext } from './context';
import { deleteMeal, logMeal, saveMealPreset } from './nutrition';
import { saveWorkout } from './workout';

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

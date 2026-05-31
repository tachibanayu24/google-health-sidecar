import type { Db } from './client';

/**
 * D1 原子性ヘルパ(§8.5)。
 * D1 はインタラクティブ tx 非対応、原子性が保証されるのは単一 db.batch() のみ。
 * 多表書込み・編集(=delete+recreate)は必ず1 batch に収める。
 * 巨大セッションは 100KB/30秒 上限に近づくので呼び出し側で分割(親→子の順)。
 */

export interface Stmt {
  sql: string;
  binds: unknown[];
}

export function stmt(sql: string, ...binds: unknown[]): Stmt {
  return { sql, binds };
}

/** 単一 db.batch() で全文を原子的に実行。1文でも違反すれば全ロールバック。 */
export async function runBatch(db: Db, statements: Stmt[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  const prepared = statements.map((s) => db.prepare(s.sql).bind(...s.binds));
  return db.d1.batch(prepared);
}

/** INSERT 文を組み立てる(列名→値)。NULL/undefined はそのままバインド。 */
export function insertStmt(table: string, row: Record<string, unknown>): Stmt {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  return stmt(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
    ...cols.map((c) => normalize(row[c])),
  );
}

/** UPSERT(主キー競合で UPDATE)。conflictCols は競合キー、updateCols は更新対象。 */
export function upsertStmt(
  table: string,
  row: Record<string, unknown>,
  conflictCols: string[],
  updateCols: string[],
): Stmt {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  const setClause = updateCols.map((c) => `${c} = excluded.${c}`).join(', ');
  return stmt(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ` +
      `ON CONFLICT (${conflictCols.join(', ')}) DO UPDATE SET ${setClause}`,
    ...cols.map((c) => normalize(row[c])),
  );
}

export function deleteByStmt(table: string, col: string, value: unknown): Stmt {
  return stmt(`DELETE FROM ${table} WHERE ${col} = ?`, normalize(value));
}

/** boolean→0/1、undefined→null に正規化(D1 バインド用)。 */
function normalize(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

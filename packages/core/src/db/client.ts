import type { ZodType } from 'zod';
import { errorMessage } from '../util/errors';

/**
 * D1 の薄いラッパ。Zod で行をパースして安全側に倒す。
 * 原子性: マルチステートメントは batch-helpers の runBatch(単一 db.batch)に集約(§8.5)。
 */
export class Db {
  constructor(readonly d1: D1Database) {}

  /** 1行 or null を取得して schema でパース。 */
  async one<T>(schema: ZodType<T>, sql: string, ...binds: unknown[]): Promise<T | null> {
    const row = await this.d1
      .prepare(sql)
      .bind(...binds)
      .first();
    if (row == null) return null;
    return parseOrThrow(schema, row, sql);
  }

  /** 全行を取得して schema でパース。 */
  async all<T>(schema: ZodType<T>, sql: string, ...binds: unknown[]): Promise<T[]> {
    const { results } = await this.d1
      .prepare(sql)
      .bind(...binds)
      .all();
    return (results ?? []).map((r) => parseOrThrow(schema, r, sql));
  }

  /** パースしない生 read(集計クエリ等)。 */
  async raw<T = Record<string, unknown>>(sql: string, ...binds: unknown[]): Promise<T[]> {
    const { results } = await this.d1
      .prepare(sql)
      .bind(...binds)
      .all();
    return (results ?? []) as T[];
  }

  /** 単発 write。多表は runBatch を使う。 */
  async run(sql: string, ...binds: unknown[]): Promise<D1Result> {
    return this.d1
      .prepare(sql)
      .bind(...binds)
      .run();
  }

  prepare(sql: string): D1PreparedStatement {
    return this.d1.prepare(sql);
  }
}

function parseOrThrow<T>(schema: ZodType<T>, row: unknown, sql: string): T {
  const parsed = schema.safeParse(row);
  if (!parsed.success) {
    throw new Error(
      `D1 row schema mismatch for [${sql.slice(0, 80)}]: ${errorMessage(parsed.error)}`,
    );
  }
  return parsed.data;
}

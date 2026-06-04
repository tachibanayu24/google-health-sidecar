import type { Context } from 'hono';

/**
 * read ルートのクエリ整数を読み、未指定/NaN/0 は def、上限 max にクランプして返す。
 * 既存の `Math.min(max, Number(c.req.query(name) ?? String(def)) || def)` 定型を1関数に集約(挙動同一)。
 */
export function clampQueryInt(c: Context, name: string, def: number, max: number): number {
  return Math.min(max, Number(c.req.query(name) ?? String(def)) || def);
}

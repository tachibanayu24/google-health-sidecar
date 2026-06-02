// 塩↔ナトリウム換算は core(係数2.54の単一ソース)を re-export。barrel でなくサブパス
// (util/units は type-only 依存=ランタイム空)を使い、クライアントバンドルに core 全体を引き込まない。
export { saltGFromSodiumMg as saltFromSodiumMg, sodiumMgFromSalt } from '@ghs/core/util/units';

// UI 用の数値整形ヘルパ。kg/lb 併記(要件8)が要るときは core の formatDual を使う。
export function round(v: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

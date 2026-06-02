// UI 用の数値整形・栄養換算ヘルパ。kg/lb 併記(要件8)が要るときは core の formatDual を使う。
export function round(v: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

// 食塩相当量(g) = ナトリウム(mg) × 2.54 / 1000(GHは sodium で保存・表示は食塩相当量)。
export function saltFromSodiumMg(mg: number): number {
  return (mg * 2.54) / 1000;
}
export function sodiumMgFromSalt(g: number): number {
  return (g * 1000) / 2.54;
}

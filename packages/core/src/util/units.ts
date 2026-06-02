import type { WeightUnit } from '../domain/enums';

/**
 * kg/lb 換算(要件8)。国際協定の定義値を使い往復誤差を最小化(§9.9)。
 * 保存は入力生値+単位が正本、集計は kg 正規化(§7.0/§8.1)。
 */
export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 1 / KG_PER_LB; // = 2.2046226218487757

export function toKg(value: number, unit: WeightUnit): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}

export function toLb(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? value : value * LB_PER_KG;
}

export function convert(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  return from === 'kg' ? value * LB_PER_KG : value * KG_PER_LB;
}

/** 小数 n 桁に丸める(表示用)。 */
export function roundTo(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * 両単位併記の表示文字列(§9.3 "80.0 kg / 176.4 lb")。
 * primary を先に出す。
 */
export function formatDual(
  value: number,
  unit: WeightUnit,
  opts: { primary?: WeightUnit; digits?: number } = {},
): string {
  const digits = opts.digits ?? 1;
  const primary = opts.primary ?? unit;
  const secondary: WeightUnit = primary === 'kg' ? 'lb' : 'kg';
  const kg = toKg(value, unit);
  const asPrimary = primary === 'kg' ? kg : kg * LB_PER_KG;
  const asSecondary = secondary === 'kg' ? kg : kg * LB_PER_KG;
  return `${roundTo(asPrimary, digits)} ${primary} / ${roundTo(asSecondary, digits)} ${secondary}`;
}

/**
 * ナトリウム(mg)↔ 食塩相当量(g)。日本の表示慣行に合わせ、保存は GH の sodium、表示は食塩相当量。
 * 係数 2.54 はここを単一ソースとする(apps/web は本関数を re-export して使用)。
 * 食塩相当量(g) = ナトリウム(mg) × 2.54 / 1000。
 */
export function saltGFromSodiumMg(mg: number): number {
  return (mg * 2.54) / 1000;
}

/** 食塩相当量(g)→ ナトリウム(mg)。GH push 用の逆変換。 */
export function sodiumMgFromSalt(g: number): number {
  return (g * 1000) / 2.54;
}

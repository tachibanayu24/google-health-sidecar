// UI 用 kg/lb 表示(core と同じ定義値)。表示は両単位併記(要件8)。
export const LB_PER_KG = 2.2046226218487757;

export function fmtKg(kg: number | null | undefined, digits = 1): string {
  if (kg == null) return '—';
  const lb = kg * LB_PER_KG;
  return `${round(kg, digits)}kg / ${round(lb, digits)}lb`;
}

export function round(v: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

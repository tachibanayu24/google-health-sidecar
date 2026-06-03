/**
 * エネルギー収支の決定的計算 — 純関数(DB/IO非依存)。BMR と適応型TDEE。
 * 実測主義: 体重トレンド×摂取から消費を逆算する(MacroFactor 方式)。推定は推定と明示し、
 * データ/遵守が薄い窓では算出しない(confidence='insufficient')。
 */

export type Sex = 'male' | 'female';

/** Mifflin-St Jeor 方程式による BMR(kcal/日)。入力が欠けたら null(推測しない)。 */
export function bmrMifflin(p: {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  sex: Sex | null;
}): number | null {
  const { weightKg, heightCm, age, sex } = p;
  if (weightKg == null || heightCm == null || age == null || sex == null) return null;
  if (weightKg <= 0 || heightCm <= 0 || age <= 0) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(base + (sex === 'male' ? 5 : -161));
}

/** 最小二乗で (x=日index, y=体重) の直線トレンドを出す。点<2 は null。 */
export function linearWeightTrend(
  points: Array<{ dayIndex: number; weightKg: number }>,
): { atStartKg: number; atEndKg: number; spanDays: number; slopePerDay: number } | null {
  if (points.length < 2) return null;
  const n = points.length;
  const xs = points.map((p) => p.dayIndex);
  const ys = points.map((p) => p.weightKg);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanDays = maxX - minX;
  if (spanDays <= 0) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  return {
    atStartKg: Math.round((intercept + slope * minX) * 100) / 100,
    atEndKg: Math.round((intercept + slope * maxX) * 100) / 100,
    spanDays,
    slopePerDay: slope,
  };
}

export interface TdeeInput {
  windowDays: number;
  daysLogged: number; // 窓内で食事記録があった日数
  avgIntakeKcal: number; // 記録日の平均摂取
  trend: { atStartKg: number; atEndKg: number; spanDays: number } | null;
}
export interface TdeeResult {
  estimatedTdeeKcal: number | null;
  weightChangeKgPerWeek: number | null;
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  note: string;
}

const KCAL_PER_KG = 7700; // 体組織1kgの概算エネルギー

/**
 * 適応型TDEE: TDEE ≈ 平均摂取 −(トレンド体重変化 × 7700 / 日数)。
 * 遵守ゲート: 体重トレンド不足/記録日数が窓の半分未満なら confidence を落とす。
 */
export function computeAdaptiveTdee(i: TdeeInput): TdeeResult {
  if (!i.trend || i.trend.spanDays < 7 || i.daysLogged < 7) {
    return {
      estimatedTdeeKcal: null,
      weightChangeKgPerWeek: null,
      confidence: 'insufficient',
      note: '体重トレンド(7日以上)または食事記録(7日以上)が不足。あと数日記録すると逆算できます。',
    };
  }
  const deltaKg = i.trend.atEndKg - i.trend.atStartKg;
  const dailyBalance = (deltaKg * KCAL_PER_KG) / i.trend.spanDays; // 摂取-消費 の日次平均
  const tdee = Math.round(i.avgIntakeKcal - dailyBalance);
  const perWeek = Math.round((deltaKg / i.trend.spanDays) * 7 * 100) / 100;
  const ratio = i.daysLogged / i.windowDays;
  const confidence = ratio >= 0.8 ? 'high' : ratio >= 0.5 ? 'medium' : 'low';
  return {
    estimatedTdeeKcal: tdee,
    weightChangeKgPerWeek: perWeek,
    confidence,
    note:
      confidence === 'low'
        ? '食事の記録日数が少なく推定の確度は低めです(記録を増やすと精度が上がります)。'
        : '体重トレンドと摂取からの逆算(推定)。',
  };
}

import { getActiveNutritionTarget, getSettings } from '../db/repositories/settings';
import {
  bmrMifflin,
  computeAdaptiveTdee,
  linearWeightTrend,
  type TdeeResult,
} from '../domain/energy';
import { type CorrelationFinding, correlate, type DayPair } from '../domain/nutrition-recovery';
import { jstDaysAgo, todayJst, toJstDateString } from '../util/date';
import type { AppContext } from './context';

/**
 * AIトレーナー向けの決定的な派生指標(§0.5 バケツB)。MCP read で露出。
 * すべて実測ベース・推定は明示。アプリ内では生成せず Claude が会話で扱う。
 */

const nextDate = (d: string) => toJstDateString(Date.parse(`${d}T00:00:00+09:00`) + 86400_000);
const dayIndexFrom = (since: string, d: string) =>
  Math.round(
    (Date.parse(`${d}T00:00:00+09:00`) - Date.parse(`${since}T00:00:00+09:00`)) / 86400_000,
  );

export interface NutritionStatus {
  windowDays: number;
  daysLogged: number;
  avgIntakeKcal: number | null;
  weightTrend: { startKg: number; endKg: number; perWeekKg: number } | null;
  estimatedTdeeKcal: number | null;
  confidence: TdeeResult['confidence'];
  bmrKcal: number | null; // 身体プロフィール(settings)があれば
  phase: string | null;
  targetKcal: number | null;
  intakeVsTargetKcal: number | null; // 平均摂取 - 目標
  note: string;
}

/** 適応型TDEE: 体重トレンド×摂取から消費を逆算(MacroFactor 方式)。windowDays 既定28。 */
export async function getNutritionStatus(
  ctx: AppContext,
  opts: { windowDays?: number } = {},
): Promise<NutritionStatus> {
  const windowDays = opts.windowDays ?? 28;
  const since = jstDaysAgo(windowDays - 1);

  const intakeRows = await ctx.db.raw<{ date: string; kcal: number }>(
    `SELECT m.date AS date, SUM(mi.calories_kcal) AS kcal
       FROM meals m JOIN meal_items mi ON mi.meal_id = m.id
      WHERE m.date >= ? GROUP BY m.date`,
    since,
  );
  const daysLogged = intakeRows.length;
  const avgIntakeKcal = daysLogged
    ? Math.round(intakeRows.reduce((a, r) => a + r.kcal, 0) / daysLogged)
    : null;

  // 体重(日ごと最新)→ 直線トレンド。
  const weightRows = await ctx.db.raw<{ date: string; weight_kg: number }>(
    `SELECT bm.date AS date, bm.weight_kg AS weight_kg FROM body_metrics bm
      WHERE bm.weight_kg IS NOT NULL AND bm.date >= ?
        AND bm.measured_at = (SELECT MAX(b2.measured_at) FROM body_metrics b2
                               WHERE b2.date = bm.date AND b2.weight_kg IS NOT NULL)
      ORDER BY bm.date`,
    since,
  );
  const trend = linearWeightTrend(
    weightRows.map((r) => ({ dayIndex: dayIndexFrom(since, r.date), weightKg: r.weight_kg })),
  );

  const tdee = computeAdaptiveTdee({
    windowDays,
    daysLogged,
    avgIntakeKcal: avgIntakeKcal ?? 0,
    trend: trend
      ? { atStartKg: trend.atStartKg, atEndKg: trend.atEndKg, spanDays: trend.spanDays }
      : null,
  });

  const [settings, target] = await Promise.all([
    getSettings(ctx.db),
    getActiveNutritionTarget(ctx.db),
  ]);
  const latestWeight = weightRows[weightRows.length - 1]?.weight_kg ?? null;
  const age = settings.birth_year ? Number(todayJst().slice(0, 4)) - settings.birth_year : null;
  const bmrKcal = bmrMifflin({
    weightKg: latestWeight,
    heightCm: settings.height_cm,
    age,
    sex: settings.sex,
  });

  return {
    windowDays,
    daysLogged,
    avgIntakeKcal,
    weightTrend: trend
      ? {
          startKg: trend.atStartKg,
          endKg: trend.atEndKg,
          perWeekKg: tdee.weightChangeKgPerWeek ?? Math.round(trend.slopePerDay * 7 * 100) / 100,
        }
      : null,
    estimatedTdeeKcal: tdee.estimatedTdeeKcal,
    confidence: tdee.confidence,
    bmrKcal,
    phase: target?.phase ?? null,
    targetKcal: target?.target_kcal ?? null,
    intakeVsTargetKcal:
      avgIntakeKcal != null && target ? Math.round(avgIntakeKcal - target.target_kcal) : null,
    note: tdee.note,
  };
}

/** 食事×翌朝の回復 の記述的相関(n と中央値差のみ)。days 既定28。 */
export async function getMealRecoveryCorrelation(
  ctx: AppContext,
  opts: { days?: number } = {},
): Promise<{ days: number; pairs: number; findings: CorrelationFinding[] }> {
  const days = opts.days ?? 28;
  const since = jstDaysAgo(days);

  // 日別の栄養合算 + 最後の食事の epoch(時刻算出用)。
  const nut = await ctx.db.raw<{
    date: string;
    sodium: number | null;
    sugar: number | null;
    carbs: number | null;
    last_at: number;
  }>(
    `SELECT m.date AS date,
            SUM(mi.sodium_mg) AS sodium, SUM(mi.sugar_g) AS sugar, SUM(mi.carbs_g) AS carbs,
            MAX(m.logged_at) AS last_at
       FROM meals m JOIN meal_items mi ON mi.meal_id = m.id
      WHERE m.date >= ? GROUP BY m.date`,
    since,
  );
  // 回復(日別): hrv/rhr(daily_metrics)+ 睡眠効率(主睡眠)。
  const metricRows = await ctx.db.raw<{ date: string; metric: string; value: number }>(
    `SELECT date, metric, value FROM daily_metrics
      WHERE metric IN ('hrv_rmssd','resting_hr') AND date >= ?`,
    since,
  );
  const sleepRows = await ctx.db.raw<{ date: string; efficiency: number | null }>(
    `SELECT date, efficiency FROM sleep_logs s WHERE date >= ?
        AND s.total_min = (SELECT MAX(s2.total_min) FROM sleep_logs s2 WHERE s2.date = s.date)`,
    since,
  );
  const hrvByDate = new Map<string, number>();
  const rhrByDate = new Map<string, number>();
  for (const r of metricRows)
    (r.metric === 'hrv_rmssd' ? hrvByDate : rhrByDate).set(r.date, r.value);
  const effByDate = new Map<string, number>();
  for (const r of sleepRows) if (r.efficiency != null) effByDate.set(r.date, r.efficiency);

  const pairs: DayPair[] = [];
  for (const n of nut) {
    const morrow = nextDate(n.date);
    const hrv = hrvByDate.get(morrow) ?? null;
    const rhr = rhrByDate.get(morrow) ?? null;
    const sleepEff = effByDate.get(morrow) ?? null;
    if (hrv == null && rhr == null && sleepEff == null) continue; // 翌朝の回復が無い日は除外
    const lastMealHour = Math.floor(((((n.last_at + 9 * 3600) % 86400) + 86400) % 86400) / 3600);
    pairs.push({
      date: n.date,
      nutrition: {
        sodiumMg: n.sodium ?? 0,
        sugarG: n.sugar ?? 0,
        carbsG: n.carbs ?? 0,
        lastMealHour,
      },
      recovery: { hrv, rhr, sleepEff },
    });
  }
  return { days, pairs: pairs.length, findings: correlate(pairs) };
}

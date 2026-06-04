import { getActiveNutritionTarget, getSettings } from '../db/repositories/settings';
import {
  bmrMifflin,
  computeAdaptiveTdee,
  linearWeightTrend,
  type TdeeResult,
} from '../domain/energy';
import { type CorrelationFinding, correlate, type DayPair } from '../domain/nutrition-recovery';
import {
  type NutritionScore,
  type ScoreTargets,
  type ScoreTotals,
  scoreNutrition,
} from '../domain/nutrition-score';
import { jstDaysAgo, todayJst, toJstDateString } from '../util/date';
import { saltGFromSodiumMg } from '../util/units';
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

export interface NutritionScoreResponse {
  date: string;
  hasTarget: boolean;
  phase: string | null;
  day: NutritionScore | null;
  categories: { mealType: string; labelJa: string; score: NutritionScore }[];
  meals: { mealType: string; foods: string[] }[]; // 全食事(間食含む)の食品名=AIの質判断用
  uncomputable: string[]; // 計算不能観点の但し書き(§3.2)
  note: string;
}

// [mealType, 表示名, 1食の取り分(普通の食事ボリューム: 朝<昼<夕・合計1.0)]。
// カテゴリ採点の閾値 = 1日目標 × share(塩分/脂質/糖質/繊維)。たんぱく質は絶対バンドで share 非依存。
const CATEGORY_LABEL: [string, string, number][] = [
  ['Breakfast', '朝食', 0.25],
  ['Lunch', '昼食', 0.35],
  ['Dinner', '夕食', 0.4],
];

// アプリでは採点しない=トレーナーAIが会話で担う観点(なぜ不可かを併記・docs/nutrition-scoring-design.md §3.2)。
const UNCOMPUTABLE = [
  '脂質の質(飽和/不飽和/オメガ3・揚げ物か): fat_g 総量しか持たず脂肪酸内訳が無いため不可',
  '血糖負荷(GI/GL): GI 値を持たず carbs_g/sugar_g から導出不可',
  '食事の質/微量栄養素/野菜量/加工度: 未保存・food_name は自由テキストで非決定的',
];

interface NutritionItemRow {
  meal_type: string;
  food_name: string;
  calories_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
}

/** meal_items 行群をマクロ合算。fiber/sodium は値を持つ行が1つも無ければ null(0扱いしない=§4.6)。 */
function totalsFrom(rows: NutritionItemRow[]): ScoreTotals {
  let kcal = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  let fiber = 0;
  let fiberN = 0;
  let na = 0;
  let naN = 0;
  for (const r of rows) {
    kcal += r.calories_kcal;
    protein += r.protein_g;
    fat += r.fat_g;
    carbs += r.carbs_g;
    if (r.fiber_g != null) {
      fiber += r.fiber_g;
      fiberN++;
    }
    if (r.sodium_mg != null) {
      na += r.sodium_mg;
      naN++;
    }
  }
  return {
    kcal,
    protein,
    fat,
    carbs,
    fiber: fiberN ? fiber : null,
    saltG: naN ? saltGFromSodiumMg(na) : null,
  };
}

/**
 * 食事スコア(マクロ目標適合度・レーダー)。1日全体 + カテゴリ別(朝昼夕・間食除く)を採点。
 * 設計: docs/nutrition-scoring-design.md。質は採点せず食品名を返す=トレーナーAIが会話で判断(§8)。
 */
export async function getNutritionScore(
  ctx: AppContext,
  date?: string,
): Promise<NutritionScoreResponse> {
  const d = date ?? todayJst();
  const rows = await ctx.db.raw<NutritionItemRow>(
    `SELECT m.meal_type AS meal_type, mi.food_name AS food_name,
            mi.calories_kcal AS calories_kcal, mi.protein_g AS protein_g, mi.fat_g AS fat_g,
            mi.carbs_g AS carbs_g, mi.fiber_g AS fiber_g, mi.sugar_g AS sugar_g, mi.sodium_mg AS sodium_mg
       FROM meals m JOIN meal_items mi ON mi.meal_id = m.id
      WHERE m.date = ?`,
    d,
  );
  const target = await getActiveNutritionTarget(ctx.db, d);

  if (!target) {
    return {
      date: d,
      hasTarget: false,
      phase: null,
      day: null,
      categories: [],
      meals: [],
      uncomputable: UNCOMPUTABLE,
      note: '栄養目標が未設定のため採点できません(set_nutrition_target)。',
    };
  }
  if (rows.length === 0) {
    return {
      date: d,
      hasTarget: true,
      phase: target.phase,
      day: null,
      categories: [],
      meals: [],
      uncomputable: UNCOMPUTABLE,
      note: `${d} の食事記録がありません。`,
    };
  }

  const targets: ScoreTargets = {
    kcal: target.target_kcal,
    protein: target.target_protein_g,
    fat: target.target_fat_g,
    carbs: target.target_carbs_g,
    salt: target.target_salt_g,
    fiber: target.target_fiber_g,
  };
  const phase = target.phase;

  const day = scoreNutrition({ totals: totalsFrom(rows), targets, phase, scope: 'day' });

  const categories = CATEGORY_LABEL.flatMap(([mt, ja, share]) => {
    const catRows = rows.filter((r) => r.meal_type === mt);
    if (!catRows.length) return [];
    return [
      {
        mealType: mt,
        labelJa: ja,
        score: scoreNutrition({
          totals: totalsFrom(catRows),
          targets,
          phase,
          scope: 'category',
          mealShare: share,
        }),
      },
    ];
  });

  // 食品名リスト(全食事=間食含む・AIの質判断用)。
  const byMeal = new Map<string, string[]>();
  for (const r of rows) {
    const a = byMeal.get(r.meal_type) ?? [];
    a.push(r.food_name);
    byMeal.set(r.meal_type, a);
  }
  const meals = [...byMeal.entries()].map(([mealType, foods]) => ({ mealType, foods }));

  return {
    date: d,
    hasTarget: true,
    phase,
    day,
    categories,
    meals,
    uncomputable: UNCOMPUTABLE,
    note: '採点はマクロの目標適合度のみ(実測)。脂質の質・GL・食事の質は不可ゆえ未採点 — 食品名から会話で質を判断してください(§8)。',
  };
}

import type { NutritionPhase } from './enums';

/**
 * 食事の栄養スコアリング(決定的・実測のみ)。設計: docs/nutrition-scoring-design.md。
 *
 * meal_items の数値(P/F/C/繊維/塩)を phase×scope 依存の台形バンドで 0..1 に写し、
 * 加重幾何平均で総合化する。カロリーは軸にせずゲート+実数表示(§3.1/§4.5)。
 *
 * 計算できない「質」(脂質の質・血糖負荷GI/GL・食事の質/微量栄養素)は **採点しない**。
 * fat_g 総量しか持たず脂肪酸内訳が無い / GI 値を持たない / food_name は自由テキストで非決定的
 * なため、推測で埋めるのは実測主義に反する。質はトレーナーAI が会話で担う(§3.2/§8)。
 */

export type NutritionAxisKey = 'protein' | 'fat' | 'carbs' | 'fiber' | 'sodium';
export type NutritionScope = 'day' | 'category';

export interface ScoreTargets {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  salt: number; // 食塩相当量(g)
  fiber: number;
}

/** 集計済みマクロ。protein/fat/carbs は NOT NULL ゆえ常在。fiber/saltG は欠損なら null(0扱いしない=§4.6)。 */
export interface ScoreTotals {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number | null;
  saltG: number | null;
}

export interface AxisScore {
  key: NutritionAxisKey;
  labelJa: string;
  value: number | null; // 実測量(g)。欠損は null
  target: number | null; // 表示用の理想参照(g)。null=絶対バンド等
  score: number | null; // 0..1。null=データ無し(—)
  zone: 'low' | 'ideal' | 'high' | 'na';
  weight: number;
}

export interface NutritionScore {
  scope: NutritionScope;
  phase: NutritionPhase;
  axes: AxisScore[];
  overall: number | null; // 0..1。採点軸が無ければ null
  calories: {
    kcal: number;
    target: number | null;
    ratio: number | null; // kcal / target
    gate: 'under' | 'ok' | 'over' | 'na'; // day のみ意味を持つ
  };
}

interface BandSpec {
  z0: number; // 下限ハード(これ以下は floorLow)
  i0: number; // 満点開始(不足側の境界)
  i1: number; // 満点終了(過剰側の境界)。+∞=過剰を罰しない
  z1: number; // 過剰ハード(これ以上は floorHigh)
  floorLow: number; // 下限側の床
  floorHigh: number; // 過剰側の床
  downCurve: 'linear' | 'quad'; // quad=累進ペナルティ
}

const INF = Number.POSITIVE_INFINITY;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * 台形バンド: 量 x を 0..1(1=理想)へ。型(下限/上限/山)は spec のパラメータで表現(§4.1)。
 * 一律リニア禁止 — 軸ごとに不足/過剰の罰し方(幅・床・curve)を変える。
 */
export function bandScore(x: number, s: BandSpec): number {
  if (x <= s.z0) return s.floorLow;
  if (x < s.i0) return clamp01(s.floorLow + (1 - s.floorLow) * ((x - s.z0) / (s.i0 - s.z0)));
  if (x <= s.i1) return 1;
  if (x < s.z1) {
    const t = (x - s.i1) / (s.z1 - s.i1);
    const p = s.downCurve === 'quad' ? t * t : t;
    return clamp01(1 - (1 - s.floorHigh) * p);
  }
  return s.floorHigh;
}

const LABEL: Record<NutritionAxisKey, string> = {
  protein: 'たんぱく質',
  fat: '脂質',
  carbs: '糖質',
  fiber: '食物繊維',
  sodium: '塩分',
};

const KEYS: NutritionAxisKey[] = ['protein', 'fat', 'carbs', 'fiber', 'sodium'];

type WeightTable = Record<NutritionAxisKey, number>;

/**
 * 加重テーブル(§4.4)。phase×scope で切替。
 * cut=たんぱく質・塩分・カロリー(ゲート)を死守。bulk=protein↓/carbs↑(筋肥大の律速)。
 * カテゴリ別は「たんぱく質の分散」が主役、他マクロは低 weight(均等割りの粗さを実害化させない)。
 */
const WEIGHTS: Record<NutritionPhase, Record<NutritionScope, WeightTable>> = {
  cut: {
    day: { protein: 3, fat: 2, carbs: 2, fiber: 2, sodium: 3 },
    category: { protein: 3, fat: 1.5, carbs: 1, fiber: 1, sodium: 0.5 },
  },
  bulk: {
    day: { protein: 2, fat: 2, carbs: 3, fiber: 2, sodium: 2 },
    category: { protein: 2, fat: 1.5, carbs: 1.5, fiber: 1, sodium: 0.5 },
  },
  maintain: {
    day: { protein: 2.5, fat: 2, carbs: 2, fiber: 2, sodium: 2.5 },
    category: { protein: 2.5, fat: 1.5, carbs: 1, fiber: 1, sodium: 0.5 },
  },
};

function axisInput(key: NutritionAxisKey, t: ScoreTotals): number | null {
  switch (key) {
    case 'protein':
      return t.protein;
    case 'fat':
      return t.fat;
    case 'carbs':
      return t.carbs;
    case 'fiber':
      return t.fiber;
    case 'sodium':
      return t.saltG;
  }
}

/** 軸 × phase × scope のバンド spec と表示用の理想参照量を返す(§4.2/§5)。 */
function specAndRef(
  key: NutritionAxisKey,
  scope: NutritionScope,
  t: ScoreTargets,
): { spec: BandSpec; ref: number | null } {
  if (scope === 'category') {
    switch (key) {
      // たんぱく質: 1日目標÷3 ではなく絶対バンド[20,40]・上振れ寛容(ロイシン閾値・§5)。
      case 'protein':
        return {
          spec: {
            z0: 8,
            i0: 20,
            i1: INF,
            z1: INF,
            floorLow: 0.05,
            floorHigh: 0,
            downCurve: 'linear',
          },
          ref: 20,
        };
      // 他マクロは 1日目標÷3 中心の広いバンド(食間配分は柔軟・夜の糖質減等を罰さない)。
      case 'fat': {
        const m = t.fat / 3; // ゆるい上限: 単日/1食の低脂質は罰しない
        return {
          spec: {
            z0: 0,
            i0: 0,
            i1: m * 1.5,
            z1: m * 2.5,
            floorLow: 1,
            floorHigh: 0,
            downCurve: 'linear',
          },
          ref: round1(m),
        };
      }
      case 'carbs': {
        const m = t.carbs / 3;
        return {
          spec: {
            z0: m * 0.2,
            i0: m * 0.5,
            i1: m * 1.5,
            z1: m * 2.5,
            floorLow: 0,
            floorHigh: 0,
            downCurve: 'linear',
          },
          ref: round1(m),
        };
      }
      case 'fiber': {
        const m = t.fiber / 3;
        return {
          spec: {
            z0: m * 0.2,
            i0: m,
            i1: INF,
            z1: INF,
            floorLow: 0,
            floorHigh: 0,
            downCurve: 'linear',
          },
          ref: round1(m),
        };
      }
      // 塩分(カテゴリ): 1食で食塩 >0.5·target だけ減点フラグ。1食で断じない。
      case 'sodium': {
        const s = t.salt;
        return {
          spec: { z0: 0, i0: 0, i1: 0.5 * s, z1: s, floorLow: 1, floorHigh: 0, downCurve: 'quad' },
          ref: round1(0.5 * s),
        };
      }
    }
  }
  // ---- day ----
  switch (key) {
    // 下限型・過剰寛容。cut は下限割れ(z0=0.6·T)を急減点(floorLow≈0.05)、極端な過剰のみ軽減点。
    case 'protein': {
      const T = t.protein;
      return {
        spec: {
          z0: 0.6 * T,
          i0: 0.88 * T,
          i1: 1.8 * T,
          z1: 2.1 * T,
          floorLow: 0.05,
          floorHigh: 0.85,
          downCurve: 'linear',
        },
        ref: T,
      };
    }
    // ゆるい上限型: 単日の下限割れは罰しない(低脂質高タンパクの日は正常)。下限は週平均でトレーナーが見る。
    case 'fat': {
      const T = t.fat;
      return {
        spec: {
          z0: 0,
          i0: 0,
          i1: 1.15 * T,
          z1: 1.7 * T,
          floorLow: 1,
          floorHigh: 0,
          downCurve: 'linear',
        },
        ref: T,
      };
    }
    // 山型。脂質と違い「下限側のペナルティを残す」= 糖質はトレ燃料(筋グリコーゲン/パフォーマンス)ゆえ
    // 極端な低糖質(z0=0.4·T)は減点する。過剰側は cut でやや厳しく。(§4.2 確認#3)
    case 'carbs': {
      const T = t.carbs;
      return {
        spec: {
          z0: 0.4 * T,
          i0: 0.8 * T,
          i1: 1.1 * T,
          z1: 1.7 * T,
          floorLow: 0,
          floorHigh: 0,
          downCurve: 'linear',
        },
        ref: T,
      };
    }
    // 下限型・上振れ寛容(過剰を罰しない)。
    case 'fiber': {
      const T = t.fiber;
      return {
        spec: {
          z0: 0.3 * T,
          i0: T,
          i1: INF,
          z1: INF,
          floorLow: 0,
          floorHigh: 0,
          downCurve: 'linear',
        },
        ref: T,
      };
    }
    // 上限型・累進(quad)。目標(=食塩相当量g)まで満点、超過は加速的に減点。
    case 'sodium': {
      const T = t.salt;
      return {
        spec: { z0: 0, i0: 0, i1: T, z1: 2 * T, floorLow: 1, floorHigh: 0, downCurve: 'quad' },
        ref: T,
      };
    }
  }
}

function zoneOf(value: number, spec: BandSpec): 'low' | 'ideal' | 'high' {
  if (value < spec.i0) return 'low';
  if (value > spec.i1) return 'high';
  return 'ideal';
}

/**
 * 1スコープ(1日 or 1カテゴリ)の採点。
 * 総合 = 加重幾何平均(1軸大崩れで全体が下がる・§4.5)。データ無し軸は除外(0にしない)。
 * day のみ収支ゲート(カロリー大幅破綻 or 塩分大幅超過 → overall に上限0.6)を別建てで適用。
 */
export function scoreNutrition(input: {
  totals: ScoreTotals;
  targets: ScoreTargets;
  phase: NutritionPhase;
  scope: NutritionScope;
}): NutritionScore {
  const { totals, targets, phase, scope } = input;
  const weights = WEIGHTS[phase][scope];

  const axes: AxisScore[] = KEYS.map((key) => {
    const value = axisInput(key, totals);
    const { spec, ref } = specAndRef(key, scope, targets);
    if (value == null) {
      return {
        key,
        labelJa: LABEL[key],
        value: null,
        target: ref,
        score: null,
        zone: 'na',
        weight: weights[key],
      };
    }
    return {
      key,
      labelJa: LABEL[key],
      value: round1(value),
      target: ref != null ? round1(ref) : null,
      score: round2(bandScore(value, spec)),
      zone: zoneOf(value, spec),
      weight: weights[key],
    };
  });

  // 加重幾何平均(score有 & weight>0 の軸のみ)。ε=0.05 で ln(0) を回避。
  const scored = axes.filter((a) => a.score != null && a.weight > 0);
  let overall: number | null = null;
  if (scored.length) {
    const W = scored.reduce((s, a) => s + a.weight, 0);
    const lnSum = scored.reduce((s, a) => s + a.weight * Math.log(Math.max(a.score ?? 0, 0.05)), 0);
    overall = Math.exp(lnSum / W);
  }

  // カロリー: 軸でなくゲート+実数表示(§4.5)。
  const ratio = targets.kcal > 0 ? totals.kcal / targets.kcal : null;
  const gate: 'under' | 'ok' | 'over' | 'na' =
    ratio == null ? 'na' : ratio > 1.25 ? 'over' : ratio < 0.8 ? 'under' : 'ok';

  // 収支致命軸ゲート(day のみ・幾何平均と別建て=二重適用回避)。
  if (scope === 'day' && overall != null) {
    const saltOver = totals.saltG != null && targets.salt > 0 && totals.saltG > 2 * targets.salt;
    if (gate === 'over' || gate === 'under' || saltOver) overall = Math.min(overall, 0.6);
  }

  return {
    scope,
    phase,
    axes,
    overall: overall != null ? round2(overall) : null,
    calories: {
      kcal: Math.round(totals.kcal),
      target: targets.kcal || null,
      ratio: ratio != null ? round2(ratio) : null,
      gate,
    },
  };
}

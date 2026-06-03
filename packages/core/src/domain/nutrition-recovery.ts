/**
 * 食事×翌朝の回復 の相関(記述統計のみ)— 純関数(DB/IO非依存)。
 * **n と中央値差だけ**を出す。因果・p値・相関係数は主張しない(実測主義)。各群 n<minPerGroup は出さない。
 * 「高塩分の翌朝は安静時心拍が高め(中央値+3bpm, n=18)」のような事実提示にとどめる。
 */
import { median } from './readiness';

export interface DayNutrition {
  sodiumMg: number;
  sugarG: number;
  carbsG: number;
  lastMealHour: number | null; // その日の最後の食事のJST時(0-23)
}
export interface NextMorningRecovery {
  hrv: number | null;
  rhr: number | null;
  sleepEff: number | null;
}
export interface DayPair {
  date: string;
  nutrition: DayNutrition;
  recovery: NextMorningRecovery; // 翌朝
}

export interface CorrelationFinding {
  dimension: string; // 例: 塩分
  split: string; // 例: 中央値 1800mg 以上 vs 未満
  metric: string; // HRV / 安静時心拍 / 睡眠効率
  unit: string;
  highN: number;
  lowN: number;
  highMedian: number;
  lowMedian: number;
  diff: number; // high群 - low群(中央値差)
}

const METRICS: Array<{ key: keyof NextMorningRecovery; label: string; unit: string }> = [
  { key: 'hrv', label: 'HRV', unit: 'ms' },
  { key: 'rhr', label: '安静時心拍', unit: 'bpm' },
  { key: 'sleepEff', label: '睡眠効率', unit: '%' },
];
const DIMENSIONS: Array<{
  key: keyof DayNutrition;
  label: string;
  unit: string;
}> = [
  { key: 'sodiumMg', label: '塩分(ナトリウム)', unit: 'mg' },
  { key: 'sugarG', label: '糖質', unit: 'g' },
  { key: 'carbsG', label: '炭水化物', unit: 'g' },
  { key: 'lastMealHour', label: '最後の食事時刻', unit: '時' },
];

function med(xs: number[]): number {
  return Math.round(median(xs) * 10) / 10;
}

/** 各 dimension を中央値で高/低に分割し、各 recovery metric の中央値差を出す。両群 n>=minPerGroup のみ。 */
export function correlate(pairs: DayPair[], minPerGroup = 5): CorrelationFinding[] {
  const findings: CorrelationFinding[] = [];
  for (const dim of DIMENSIONS) {
    const withDim = pairs.filter((p) => p.nutrition[dim.key] != null);
    const dimVals = withDim.map((p) => p.nutrition[dim.key] as number);
    if (dimVals.length < minPerGroup * 2) continue;
    const splitAt = median(dimVals);
    for (const m of METRICS) {
      const high: number[] = [];
      const low: number[] = [];
      for (const p of withDim) {
        const rv = p.recovery[m.key];
        if (rv == null) continue;
        const dv = p.nutrition[dim.key] as number;
        (dv >= splitAt ? high : low).push(rv);
      }
      if (high.length < minPerGroup || low.length < minPerGroup) continue;
      const hi = med(high);
      const lo = med(low);
      findings.push({
        dimension: dim.label,
        split: `中央値 ${Math.round(splitAt * 10) / 10}${dim.unit} 以上 vs 未満`,
        metric: m.label,
        unit: m.unit,
        highN: high.length,
        lowN: low.length,
        highMedian: hi,
        lowMedian: lo,
        diff: Math.round((hi - lo) * 10) / 10,
      });
    }
  }
  return findings;
}

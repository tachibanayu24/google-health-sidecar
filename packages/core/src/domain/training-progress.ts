/**
 * 種目別 e1RM 進捗の停滞検知 — 純関数(DB/IO非依存)。
 * 前半セッションの最高 e1RM vs 後半の最高を比較し、伸び/停滞/低下を記述的に分類する。
 * 判定(デロードすべきか等)はしない — Claude が会話で扱う材料を返すだけ(実測主義)。
 */

export type E1rmTrend = 'progressing' | 'plateau' | 'declining';

export interface E1rmPoint {
  date: string; // YYYY-MM-DD(セッション日)
  e1rm: number; // そのセッションの最高 e1RM(kg)
}

export interface PlateauResult {
  trend: E1rmTrend;
  earlyBestE1rm: number; // 前半の最高
  lateBestE1rm: number; // 後半の最高
  pctChange: number; // (late-early)/early * 100
  sessions: number;
}

const THRESHOLD_PCT = 2; // ±2% を停滞帯とする(工学的選択)

/** 3セッション以上の e1RM 系列を前後半に分け、最高値の変化で分類。点不足は null。 */
export function classifyE1rmTrend(series: E1rmPoint[]): PlateauResult | null {
  if (series.length < 3) return null;
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  const mid = Math.floor(sorted.length / 2);
  const early = sorted.slice(0, mid).length ? sorted.slice(0, mid) : sorted.slice(0, 1);
  const late = sorted.slice(mid);
  const earlyBest = Math.max(...early.map((p) => p.e1rm));
  const lateBest = Math.max(...late.map((p) => p.e1rm));
  const pct = earlyBest > 0 ? ((lateBest - earlyBest) / earlyBest) * 100 : 0;
  const trend: E1rmTrend =
    pct >= THRESHOLD_PCT ? 'progressing' : pct <= -THRESHOLD_PCT ? 'declining' : 'plateau';
  return {
    trend,
    earlyBestE1rm: Math.round(earlyBest * 100) / 100,
    lateBestE1rm: Math.round(lateBest * 100) / 100,
    pctChange: Math.round(pct * 10) / 10,
    sessions: sorted.length,
  };
}

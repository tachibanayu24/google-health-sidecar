import { describe, expect, it } from 'vitest';
import { correlate, type DayPair } from './nutrition-recovery';

// 高塩分の日(翌朝RHRを高め)6日 + 低塩分6日。他次元は一定。
function mk(date: string, sodium: number, rhr: number): DayPair {
  return {
    date,
    nutrition: { sodiumMg: sodium, sugarG: 50, carbsG: 200, lastMealHour: 20 },
    recovery: { hrv: 50, rhr, sleepEff: 90 },
  };
}

describe('correlate', () => {
  it('各群 n>=5 で中央値差を出す(塩分→安静時心拍)', () => {
    const pairs: DayPair[] = [
      ...[0, 1, 2, 3, 4, 5].map((i) => mk(`2026-05-0${i + 1}`, 3000, 60)), // 高塩 RHR60
      ...[0, 1, 2, 3, 4, 5].map((i) => mk(`2026-05-1${i}`, 1000, 55)), // 低塩 RHR55
    ];
    const findings = correlate(pairs);
    const f = findings.find((x) => x.dimension.includes('塩分') && x.metric === '安静時心拍');
    expect(f).toBeDefined();
    expect(f!.highMedian).toBe(60);
    expect(f!.lowMedian).toBe(55);
    expect(f!.diff).toBe(5);
    expect(f!.highN).toBeGreaterThanOrEqual(5);
  });
  it('群が小さい(n<5)と出さない', () => {
    const pairs: DayPair[] = [0, 1, 2].map((i) => mk(`2026-05-0${i + 1}`, 3000, 60));
    expect(correlate(pairs)).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { bmrMifflin, computeAdaptiveTdee, linearWeightTrend } from './energy';

describe('bmrMifflin', () => {
  it('男性の標準計算', () => {
    // 10*72 + 6.25*175 - 5*30 + 5 = 720 + 1093.75 - 150 + 5 = 1668.75 → 1669
    expect(bmrMifflin({ weightKg: 72, heightCm: 175, age: 30, sex: 'male' })).toBe(1669);
  });
  it('女性は -161', () => {
    expect(bmrMifflin({ weightKg: 60, heightCm: 160, age: 30, sex: 'female' })).toBe(
      Math.round(10 * 60 + 6.25 * 160 - 5 * 30 - 161),
    );
  });
  it('入力欠損は null(推測しない)', () => {
    expect(bmrMifflin({ weightKg: 72, heightCm: null, age: 30, sex: 'male' })).toBeNull();
  });
});

describe('linearWeightTrend', () => {
  it('減少トレンドの傾きと端点', () => {
    const t = linearWeightTrend([
      { dayIndex: 0, weightKg: 73 },
      { dayIndex: 14, weightKg: 72 },
      { dayIndex: 28, weightKg: 71 },
    ]);
    expect(t).not.toBeNull();
    expect(t!.slopePerDay).toBeCloseTo(-1 / 14, 4);
    expect(t!.atStartKg).toBeCloseTo(73, 1);
    expect(t!.atEndKg).toBeCloseTo(71, 1);
    expect(t!.spanDays).toBe(28);
  });
  it('点が1つ以下/同日のみは null', () => {
    expect(linearWeightTrend([{ dayIndex: 5, weightKg: 70 }])).toBeNull();
  });
});

describe('computeAdaptiveTdee', () => {
  it('減量中: TDEE = 平均摂取 - 日次赤字', () => {
    // 28日で -1kg, 平均摂取2000 → 日次balance = -1*7700/28 = -275 → TDEE = 2000+275 = 2275
    const r = computeAdaptiveTdee({
      windowDays: 28,
      daysLogged: 26,
      avgIntakeKcal: 2000,
      trend: { atStartKg: 72, atEndKg: 71, spanDays: 28 },
    });
    expect(r.estimatedTdeeKcal).toBe(2275);
    expect(r.confidence).toBe('high');
    expect(r.weightChangeKgPerWeek).toBeCloseTo(-0.25, 2);
  });
  it('記録不足は insufficient', () => {
    const r = computeAdaptiveTdee({
      windowDays: 28,
      daysLogged: 3,
      avgIntakeKcal: 2000,
      trend: { atStartKg: 72, atEndKg: 71, spanDays: 28 },
    });
    expect(r.confidence).toBe('insufficient');
    expect(r.estimatedTdeeKcal).toBeNull();
  });
  it('記録日数が窓の半分未満は low', () => {
    const r = computeAdaptiveTdee({
      windowDays: 28,
      daysLogged: 10,
      avgIntakeKcal: 2000,
      trend: { atStartKg: 72, atEndKg: 71.5, spanDays: 28 },
    });
    expect(r.confidence).toBe('low');
    expect(r.estimatedTdeeKcal).not.toBeNull();
  });
});

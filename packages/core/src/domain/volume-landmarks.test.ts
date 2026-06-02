import { describe, expect, it } from 'vitest';
import { acuteChronicRatio, classifyLoadTrend, volumeLandmarkZone } from './volume-landmarks';

const chest = { mev: 8, mavLow: 12, mavHigh: 20, mrv: 22 };

describe('volumeLandmarkZone', () => {
  it('MEV未満=under', () => {
    expect(volumeLandmarkZone(6, chest)).toBe('under');
    expect(volumeLandmarkZone(7, chest)).toBe('under');
  });
  it('MEV..MAV下限=building', () => {
    expect(volumeLandmarkZone(8, chest)).toBe('building');
    expect(volumeLandmarkZone(11, chest)).toBe('building');
  });
  it('MAV帯=optimal(境界含む)', () => {
    expect(volumeLandmarkZone(12, chest)).toBe('optimal');
    expect(volumeLandmarkZone(20, chest)).toBe('optimal');
  });
  it('MAV超..MRV=high', () => {
    expect(volumeLandmarkZone(21, chest)).toBe('high');
    expect(volumeLandmarkZone(22, chest)).toBe('high');
  });
  it('MRV超=over', () => {
    expect(volumeLandmarkZone(23, chest)).toBe('over');
  });
  it('ランドマーク未設定(null列)は zone=null', () => {
    expect(
      volumeLandmarkZone(10, { mev: null, mavLow: null, mavHigh: null, mrv: null }),
    ).toBeNull();
  });
});

describe('acuteChronicRatio / classifyLoadTrend', () => {
  it('慢性ベースが薄い(<1)と比は出さない', () => {
    expect(acuteChronicRatio(4, 0.5)).toBeNull();
    expect(classifyLoadTrend(null)).toBeNull();
  });
  it('比を計算', () => {
    expect(acuteChronicRatio(16, 8)).toBe(2);
    expect(acuteChronicRatio(6, 8)).toBe(0.75);
  });
  it('トレンド分類', () => {
    expect(classifyLoadTrend(0.6)).toBe('detraining');
    expect(classifyLoadTrend(1.0)).toBe('steady');
    expect(classifyLoadTrend(1.3)).toBe('steady');
    expect(classifyLoadTrend(1.45)).toBe('ramping');
    expect(classifyLoadTrend(2.0)).toBe('spiking');
  });
});

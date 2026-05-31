import { describe, expect, it } from 'vitest';
import type { LoadInput } from './metrics';
import {
  computeE1rmKg,
  computeLoadKg,
  computeSetVolumeKg,
  isProvisional,
  limbMultiplier,
  prBasisOf,
  setTypeStimulusWeight,
} from './metrics';

const base: LoadInput = {
  loadMode: 'weighted',
  entryValue: 80,
  entryUnit: 'kg',
  loadBasis: 'total',
  isBodyweight: false,
  bwFactor: 1.0,
  bodyweightKg: 72,
};

describe('computeLoadKg', () => {
  it('weighted barbell = entry', () => {
    expect(computeLoadKg(base)).toBe(80);
  });

  it('weighted lb is converted to kg', () => {
    expect(computeLoadKg({ ...base, entryValue: 185, entryUnit: 'lb' })).toBeCloseTo(83.91, 1);
  });

  it('dumbbell (per_limb) doubles entry for volume', () => {
    expect(computeLoadKg({ ...base, entryValue: 20, loadBasis: 'per_limb' })).toBe(40);
  });

  it('per_side machine doubles entry', () => {
    expect(computeLoadKg({ ...base, entryValue: 25, loadBasis: 'per_side' })).toBe(50);
  });

  it('weighted dip: bodyweight + belt', () => {
    const v = computeLoadKg({ ...base, isBodyweight: true, entryValue: 10, bodyweightKg: 72 });
    expect(v).toBe(82); // 72*1.0 + 10
  });

  it('pure bodyweight uses bw_factor', () => {
    const v = computeLoadKg({
      ...base,
      loadMode: 'bodyweight',
      entryValue: null,
      isBodyweight: true,
      bwFactor: 0.65,
      bodyweightKg: 72,
    });
    expect(v).toBeCloseTo(46.8, 5); // 72*0.65
  });

  it('assisted subtracts from bodyweight, floored at 0', () => {
    const v = computeLoadKg({
      ...base,
      loadMode: 'assisted',
      entryValue: 15,
      isBodyweight: true,
      bodyweightKg: 72,
    });
    expect(v).toBe(57); // 72 - 15
    const floored = computeLoadKg({
      ...base,
      loadMode: 'assisted',
      entryValue: 100,
      isBodyweight: true,
      bodyweightKg: 72,
    });
    expect(floored).toBe(0);
  });
});

describe('limbMultiplier', () => {
  it('total=1, per_limb/per_side=2', () => {
    expect(limbMultiplier('total')).toBe(1);
    expect(limbMultiplier('per_limb')).toBe(2);
    expect(limbMultiplier('per_side')).toBe(2);
  });
});

describe('computeSetVolumeKg', () => {
  it('load × reps', () => {
    expect(computeSetVolumeKg(80, 8)).toBe(640);
  });
  it('null/zero reps → 0', () => {
    expect(computeSetVolumeKg(80, null)).toBe(0);
    expect(computeSetVolumeKg(80, 0)).toBe(0);
  });
});

describe('computeE1rmKg', () => {
  it('epley 100×5 ≈ 116.67', () => {
    expect(computeE1rmKg(100, 5, 'epley')).toBeCloseTo(116.67, 1);
  });
  it('1 rep = load', () => {
    expect(computeE1rmKg(120, 1)).toBe(120);
  });
  it('reps>12 → null (参考値)', () => {
    expect(computeE1rmKg(60, 15)).toBeNull();
  });
  it('brzycki differs from epley', () => {
    const e = computeE1rmKg(100, 5, 'epley');
    const b = computeE1rmKg(100, 5, 'brzycki');
    expect(e).not.toBe(b);
  });
});

describe('PR basis', () => {
  it('amrap/failure → confirmed', () => {
    expect(prBasisOf('amrap', null)).toBe('amrap');
    expect(prBasisOf('failure', null)).toBe('failure');
  });
  it('rpe present → rpe_backed', () => {
    expect(prBasisOf('main', 8)).toBe('rpe_backed');
  });
  it('no rpe → rpe_less (provisional)', () => {
    expect(prBasisOf('main', null)).toBe('rpe_less');
    expect(isProvisional('rpe_less')).toBe(true);
    expect(isProvisional('rpe_backed')).toBe(false);
  });
});

describe('setTypeStimulusWeight', () => {
  it('warmup low, failure high', () => {
    expect(setTypeStimulusWeight('warmup')).toBe(0.3);
    expect(setTypeStimulusWeight('failure')).toBe(1.1);
    expect(setTypeStimulusWeight('main')).toBe(1.0);
  });
});

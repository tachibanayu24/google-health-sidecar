import { describe, expect, it } from 'vitest';
import { convert, formatDual, KG_PER_LB, LB_PER_KG, roundTo, toKg, toLb } from './units';

describe('units', () => {
  it('toKg / toLb identity within unit', () => {
    expect(toKg(80, 'kg')).toBe(80);
    expect(toLb(185, 'lb')).toBe(185);
  });

  it('lb→kg uses defined constant', () => {
    expect(toKg(100, 'lb')).toBeCloseTo(45.359237, 6);
    expect(toLb(100, 'kg')).toBeCloseTo(220.46226218, 6);
  });

  it('round-trip 80kg → lb → kg has no drift beyond float epsilon', () => {
    const lb = convert(80, 'kg', 'lb');
    const back = convert(lb, 'lb', 'kg');
    expect(back).toBeCloseTo(80, 10);
  });

  it('constants are reciprocal', () => {
    expect(KG_PER_LB * LB_PER_KG).toBeCloseTo(1, 12);
  });

  it('formatDual shows both units, primary first', () => {
    expect(formatDual(80, 'kg', { primary: 'kg' })).toBe('80 kg / 176.4 lb');
    expect(formatDual(185, 'lb', { primary: 'lb' })).toBe('185 lb / 83.9 kg');
  });

  it('roundTo', () => {
    expect(roundTo(176.36981, 1)).toBe(176.4);
    expect(roundTo(83.91458, 1)).toBe(83.9);
  });
});

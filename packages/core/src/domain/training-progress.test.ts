import { describe, expect, it } from 'vitest';
import { classifyE1rmTrend } from './training-progress';

const pt = (date: string, e1rm: number) => ({ date, e1rm });

describe('classifyE1rmTrend', () => {
  it('後半の最高が前半より2%超で progressing', () => {
    const r = classifyE1rmTrend([
      pt('2026-05-01', 100),
      pt('2026-05-08', 101),
      pt('2026-05-15', 105),
      pt('2026-05-22', 108),
    ]);
    expect(r?.trend).toBe('progressing');
    expect(r?.earlyBestE1rm).toBe(101);
    expect(r?.lateBestE1rm).toBe(108);
  });
  it('±2%以内は plateau', () => {
    const r = classifyE1rmTrend([pt('a', 100), pt('b', 99), pt('c', 100.5), pt('d', 101)]);
    expect(r?.trend).toBe('plateau');
  });
  it('後半が2%超下落で declining', () => {
    const r = classifyE1rmTrend([pt('a', 110), pt('b', 108), pt('c', 100), pt('d', 99)]);
    expect(r?.trend).toBe('declining');
  });
  it('3セッション未満は null', () => {
    expect(classifyE1rmTrend([pt('a', 100), pt('b', 105)])).toBeNull();
  });
});

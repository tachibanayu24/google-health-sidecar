import { describe, expect, it } from 'vitest';
import {
  epochToJstDate,
  epochToJstHhmm,
  formatDateForDisplay,
  jstDayOfWeek,
  shiftDate,
} from './datetime';

describe('shiftDate(日付ナビ/ピッカーの土台)', () => {
  it('±1日', () => {
    expect(shiftDate('2026-06-03', -1)).toBe('2026-06-02');
    expect(shiftDate('2026-06-03', 1)).toBe('2026-06-04');
  });
  it('月またぎ', () => {
    expect(shiftDate('2026-06-01', -1)).toBe('2026-05-31');
    expect(shiftDate('2026-05-31', 1)).toBe('2026-06-01');
  });
  it('うるう年の2月末(2024)', () => {
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDate('2024-03-01', -1)).toBe('2024-02-29');
  });
});

describe('jstDayOfWeek', () => {
  it('2026-06-03 は水曜(=3)', () => {
    expect(jstDayOfWeek('2026-06-03')).toBe(3);
  });
});

describe('formatDateForDisplay', () => {
  it('YYYY-MM-DD → M/D 表記(M/D は月日のゼロ詰めのまま)', () => {
    expect(formatDateForDisplay('2026-06-03')).toBe('06/03');
  });
});

describe('epoch 変換(JST)', () => {
  it('epoch秒 → JST日付/時刻', () => {
    // 1780483032 = 2026-06-03 10:37:12 UTC = 19:37 JST(同日)
    expect(epochToJstDate(1780483032)).toBe('2026-06-03');
    expect(epochToJstHhmm(1780483032)).toBe('19:37');
  });
});

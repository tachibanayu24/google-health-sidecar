import { describe, expect, it } from 'vitest';
import {
  assertIsoDate,
  jstDatePlusDays,
  jstDayOfWeek,
  jstDaysAgo,
  lastCompletedWeekJst,
  normalizeRange,
  toJstDateString,
  weekBoundsSec,
} from './date';

describe('toJstDateString', () => {
  it('UTC を JST(+9h)の日付に変換する', () => {
    // 2026-06-01T20:00:00Z は JST 2026-06-02 05:00 → 翌日。
    expect(toJstDateString('2026-06-01T20:00:00Z')).toBe('2026-06-02');
    // 2026-06-01T10:00:00Z は JST 2026-06-01 19:00 → 同日。
    expect(toJstDateString('2026-06-01T10:00:00Z')).toBe('2026-06-01');
  });

  it('JST 日付境界: UTC 14:59 は前日、15:00 は当日(JST 0時 = UTC 15時)', () => {
    expect(toJstDateString('2026-06-01T14:59:59Z')).toBe('2026-06-01');
    expect(toJstDateString('2026-06-01T15:00:00Z')).toBe('2026-06-02');
  });

  it('ms / Date 入力も受ける', () => {
    expect(toJstDateString(Date.parse('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
    expect(toJstDateString(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
  });

  it('不正入力は RangeError', () => {
    expect(() => toJstDateString('not-a-date')).toThrow(RangeError);
  });
});

describe('jstDaysAgo', () => {
  it('JST基準で n 日前を返す', () => {
    const from = new Date('2026-06-10T10:00:00Z'); // JST 6/10 19:00
    expect(jstDaysAgo(0, from)).toBe('2026-06-10');
    expect(jstDaysAgo(7, from)).toBe('2026-06-03');
    expect(jstDaysAgo(14, from)).toBe('2026-05-27');
  });

  it('月またぎ', () => {
    expect(jstDaysAgo(1, new Date('2026-03-01T10:00:00Z'))).toBe('2026-02-28');
  });
});

describe('assertIsoDate / normalizeRange', () => {
  it('正しい YYYY-MM-DD は通る', () => {
    expect(() => assertIsoDate('2026-06-01')).not.toThrow();
  });
  it('不正な日付形式を弾く', () => {
    expect(() => assertIsoDate('2026/06/01')).toThrow(RangeError);
    expect(() => assertIsoDate('2026-13-01')).toThrow(RangeError); // 13月
    expect(() => assertIsoDate('2026-06-32')).toThrow(RangeError); // 32日
  });
  it('逆転レンジを弾く', () => {
    expect(() => normalizeRange('2026-06-10', '2026-06-01')).toThrow(RangeError);
    expect(normalizeRange('2026-06-01', '2026-06-10')).toEqual({
      start: '2026-06-01',
      end: '2026-06-10',
    });
  });
});

describe('jstDayOfWeek (JST 曜日・UTC ローカルTZ非依存)', () => {
  it('JST の曜日を返す(2026-06-07 は日曜)', () => {
    expect(jstDayOfWeek('2026-06-07')).toBe(0); // 日
    expect(jstDayOfWeek('2026-06-08')).toBe(1); // 月
    expect(jstDayOfWeek('2026-06-06')).toBe(6); // 土
    expect(jstDayOfWeek('2026-05-31')).toBe(0); // 日
  });
});

describe('jstDatePlusDays (JST 暦日加減算・月/年またぎ)', () => {
  it('月またぎ', () => {
    expect(jstDatePlusDays('2026-05-31', 1)).toBe('2026-06-01');
    expect(jstDatePlusDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('年またぎ', () => {
    expect(jstDatePlusDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('週ぶん', () => {
    expect(jstDatePlusDays('2026-06-07', -7)).toBe('2026-05-31');
    expect(jstDatePlusDays('2026-05-31', 6)).toBe('2026-06-06');
  });
});

describe('lastCompletedWeekJst (直近完了週=先週日〜土)', () => {
  it('月曜起点でも日曜・土曜起点でも先週(日〜土)を返す', () => {
    const expected = { weekStart: '2026-05-31', weekEnd: '2026-06-06' };
    expect(lastCompletedWeekJst('2026-06-08')).toEqual(expected); // 月
    expect(lastCompletedWeekJst('2026-06-07')).toEqual(expected); // 当日が日曜でも先週
    expect(lastCompletedWeekJst('2026-06-13')).toEqual(expected); // 土
  });
});

describe('weekBoundsSec (epoch境界)', () => {
  it('日曜00:00:00 〜 土曜23:59:59 の +09:00 境界を返す', () => {
    const { startSec, endSec } = weekBoundsSec('2026-05-31', '2026-06-06');
    expect(startSec).toBe(Math.floor(Date.parse('2026-05-31T00:00:00+09:00') / 1000));
    expect(endSec).toBe(Math.floor(Date.parse('2026-06-06T23:59:59+09:00') / 1000));
    expect(endSec - startSec).toBe(6 * 86400 + 86399); // 6日 + 23:59:59
  });
});

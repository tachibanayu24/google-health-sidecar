const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Date/ms/ISO を JST の YYYY-MM-DD に整形。既定は「JSTの今日」。 */
export function toJstDateString(input: Date | string | number = new Date()): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new RangeError(`Invalid date input: ${String(input)}`);
  }
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function todayJst(): string {
  return toJstDateString();
}

/** JST基準で n 日前の YYYY-MM-DD。 */
export function jstDaysAgo(n: number, from: Date = new Date()): string {
  return toJstDateString(from.getTime() - n * 24 * 60 * 60 * 1000);
}

const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function assertIsoDate(value: string, field = 'date'): asserts value is string {
  if (!ISO_DATE_RE.test(value)) {
    throw new RangeError(`${field} must be YYYY-MM-DD (got: ${value})`);
  }
}

export function normalizeRange(start: string, end: string): { start: string; end: string } {
  assertIsoDate(start, 'start');
  assertIsoDate(end, 'end');
  if (start > end) {
    throw new RangeError(`Range is inverted: start=${start} > end=${end}`);
  }
  return { start, end };
}

/** 現在の unixepoch 秒。 */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * JST基準の曜日(0=日..6=土)。Worker のローカルTZ(UTC)に依存しないよう、
 * epoch(+09:00 でパース)に +9h して getUTCDay で JST 曜日を取る(getDay は使わない=off-by-one 防止)。
 */
export function jstDayOfWeek(dateStr: string): number {
  assertIsoDate(dateStr, 'date');
  return new Date(Date.parse(`${dateStr}T00:00:00+09:00`) + JST_OFFSET_MS).getUTCDay();
}

/** JST日付文字列を delta 日ずらす(JSTの暦日加減算)。 */
export function jstDatePlusDays(dateStr: string, delta: number): string {
  assertIsoDate(dateStr, 'date');
  return toJstDateString(Date.parse(`${dateStr}T00:00:00+09:00`) + delta * 86400_000);
}

/**
 * 直近の「完了した」JST週(日〜土)。weekStart=先週日曜・weekEnd=先週土曜。
 * 進行中(今週)は含めない=週次レポートの既定対象(docs/weekly-report-design.md §1)。
 */
export function lastCompletedWeekJst(from: string = todayJst()): {
  weekStart: string;
  weekEnd: string;
} {
  const dow = jstDayOfWeek(from); // 0=日..6=土
  const thisSunday = jstDatePlusDays(from, -dow); // 今週日曜
  const weekStart = jstDatePlusDays(thisSunday, -7); // 先週日曜
  const weekEnd = jstDatePlusDays(weekStart, 6); // 先週土曜
  return { weekStart, weekEnd };
}

/**
 * 週(JST日付)の epoch秒境界。startSec=日曜00:00:00+09:00 / endSec=土曜23:59:59+09:00。
 * getWeeklySummary / getWeekReviewData が PR 達成時刻等の突合に共有する。
 */
export function weekBoundsSec(
  weekStart: string,
  weekEnd: string,
): { startSec: number; endSec: number } {
  assertIsoDate(weekStart, 'weekStart');
  assertIsoDate(weekEnd, 'weekEnd');
  return {
    startSec: Math.floor(Date.parse(`${weekStart}T00:00:00+09:00`) / 1000),
    endSec: Math.floor(Date.parse(`${weekEnd}T23:59:59+09:00`) / 1000),
  };
}

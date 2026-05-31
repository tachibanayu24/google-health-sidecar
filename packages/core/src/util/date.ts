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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `Retry-After`(delta秒 or HTTP-date)をパースしてクランプ。
 * 想定外の値は fallback にして長時間待ちの事故を防ぐ。
 */
export function parseRetryAfter(
  header: string | null | undefined,
  opts: { fallbackSec?: number; maxSec?: number } = {},
): number {
  const { fallbackSec = 5, maxSec = 60 } = opts;
  if (!header) return fallbackSec;
  const n = Number(header);
  if (!Number.isFinite(n) || n < 0) return fallbackSec;
  return Math.min(maxSec, Math.max(1, Math.ceil(n)));
}

/** 指数バックオフの待ち時間(ms)。attempt は1始まり。 */
export function backoffMs(attempt: number, baseMs = 500, maxMs = 15_000): number {
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1));
}

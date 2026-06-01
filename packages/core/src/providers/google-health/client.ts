import { ProviderApiError, RateLimitError } from '../../util/errors';
import { backoffMs, parseRetryAfter, sleep } from '../../util/rate-limit';
import { GH_BASE, GH_USER, RECONCILE_VERB } from './discovery-pin';

export type GetToken = () => Promise<string>;

/**
 * Google Health API v4 の薄い HTTP クライアント。
 * 認証トークンは auth 層から関数注入(循環依存回避)。429 は指数バックオフ再試行。
 */
export class GhClient {
  private readonly maxAttempts = 3;
  constructor(private readonly getToken: GetToken) {}

  private dpPath(dataType: string): string {
    return `${GH_BASE}/users/${GH_USER}/dataTypes/${dataType}/dataPoints`;
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    body?: unknown,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const token = await this.getToken();
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429) {
        const waitSec = parseRetryAfter(res.headers.get('Retry-After'), { fallbackSec: 0 });
        // 最終試行でも 429 → recoverable な RateLimitError を投げ、呼び出し側で次cron送りに分岐できるように。
        if (attempt >= this.maxAttempts) {
          throw new RateLimitError(
            waitSec > 0 ? waitSec : Math.round(backoffMs(attempt) / 1000),
            url,
          );
        }
        await sleep(waitSec > 0 ? waitSec * 1000 : backoffMs(attempt));
        continue;
      }

      const text = await res.text();
      if (!res.ok) throw new ProviderApiError(res.status, text, url);
      return (text ? JSON.parse(text) : {}) as T;
    }
  }

  createDataPoint<T = unknown>(dataType: string, payload: unknown): Promise<T> {
    return this.request<T>('POST', this.dpPath(dataType), payload);
  }

  /** reconcile は GET + query(discovery doc 確定, §5.1)。body は持たない。 */
  reconcile<T = unknown>(dataType: string, query: Record<string, string | undefined>): Promise<T> {
    const u = new URL(`${this.dpPath(dataType)}:reconcile`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') u.searchParams.set(k, v);
    }
    return this.request<T>(RECONCILE_VERB, u.toString());
  }

  batchDelete(dataType: string, names: string[]): Promise<unknown> {
    return this.request('POST', `${this.dpPath(dataType)}:batchDelete`, { names });
  }
}

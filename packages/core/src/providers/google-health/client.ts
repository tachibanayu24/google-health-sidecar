import { ProviderApiError } from '../../util/errors';
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
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
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

      if (res.status === 429 && attempt < this.maxAttempts) {
        const waitSec = parseRetryAfter(res.headers.get('Retry-After'), { fallbackSec: 0 });
        await sleep(waitSec > 0 ? waitSec * 1000 : backoffMs(attempt));
        continue;
      }

      const text = await res.text();
      if (!res.ok) {
        throw new ProviderApiError(res.status, text, url);
      }
      return (text ? JSON.parse(text) : {}) as T;
    }
    // 到達しない(ループは return か throw で抜ける)。型のための保険。
    throw new ProviderApiError(0, 'GhClient.request: max attempts exceeded', url);
  }

  createDataPoint<T = unknown>(dataType: string, payload: unknown): Promise<T> {
    return this.request<T>('POST', this.dpPath(dataType), payload);
  }

  reconcile<T = unknown>(dataType: string, payload: unknown): Promise<T> {
    return this.request<T>(RECONCILE_VERB, `${this.dpPath(dataType)}:reconcile`, payload);
  }

  list<T = unknown>(dataType: string, query: Record<string, string | undefined>): Promise<T> {
    const u = new URL(this.dpPath(dataType));
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') u.searchParams.set(k, v);
    }
    return this.request<T>('GET', u.toString());
  }

  batchDelete(dataType: string, names: string[]): Promise<unknown> {
    return this.request('POST', `${this.dpPath(dataType)}:batchDelete`, { names });
  }
}

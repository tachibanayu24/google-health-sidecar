/**
 * KV を使った read キャッシュ(GH read結果 TTL1h, §4.2)。
 * Env ではなく KVNamespace を直接受けてプロバイダ非依存に。
 */
export const DEFAULT_CACHE_TTL_SEC = 60 * 60; // 1h

export async function getCached<T>(
  kv: KVNamespace,
  key: string,
  fetcher: () => Promise<T>,
  opts: { ttlSec?: number } = {},
): Promise<T> {
  const hit = await kv.get(key, 'json');
  if (hit !== null && hit !== undefined) {
    return hit as T;
  }
  const fresh = await fetcher();
  await kv.put(key, JSON.stringify(fresh), {
    expirationTtl: opts.ttlSec ?? DEFAULT_CACHE_TTL_SEC,
  });
  return fresh;
}

export async function invalidate(kv: KVNamespace, ...keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => kv.delete(k)));
}

/** 安定キャッシュキー(endpoint + 整列済み引数)。 */
export function cacheKey(endpoint: string, args: Record<string, unknown> = {}): string {
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return parts ? `${endpoint}?${parts}` : endpoint;
}

/**
 * Logbook 最小 Service Worker(インストール可能化 + オフライン shell)。
 * 方針(リッチ化は後続):
 *  - /api・/auth・/healthz は常にネットワーク(キャッシュしない=認証/データは鮮度優先)
 *  - ナビゲーション(SPA)は network-first → オフライン時のみ cached '/' を返す
 *  - /assets/*(content-hash 付き immutable)は cache-first
 *  - アイコン/manifest は stale-while-revalidate
 */
const VERSION = 'logbook-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Worker ルートはキャッシュ介在させない(認証/データ/ヘルス)。
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/auth') ||
    url.pathname === '/healthz'
  ) {
    return;
  }

  // SPA ナビゲーション: network-first(更新を拾う)→ オフライン時 cached '/'。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/', { ignoreSearch: true }).then((r) => r || Response.error()),
      ),
    );
    return;
  }

  // content-hash 付きアセット: cache-first(不変)。
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // アイコン/manifest 等: stale-while-revalidate。
  event.respondWith(
    caches.match(request).then((hit) => {
      const net = fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});

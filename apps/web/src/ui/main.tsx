import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './App';
import { LoginGate } from './LoginGate';
import { invalidateAfterFlush } from './lib/invalidate';
import { flushOutbox } from './lib/outbox';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

// オフライン送信キューのフラッシュ(§9.8): オンライン復帰・前面復帰・起動時に再送。
// 送信できたら関連クエリを無効化して最新化。iOS は Background Sync 非対応なので JS 主導。
function flushAndRefresh(): void {
  flushOutbox().then((r) => {
    if (r.sent > 0) invalidateAfterFlush(queryClient);
  });
}
window.addEventListener('online', flushAndRefresh);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') flushAndRefresh();
});
flushAndRefresh();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LoginGate>
        <RouterProvider router={router} />
      </LoginGate>
    </QueryClientProvider>
  </StrictMode>,
);

// PWA: Service Worker 登録(本番のみ。dev=localhost は vite と干渉するため除外)。
const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && !isLocalDev) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW 登録失敗は致命的でない(オフライン機能のみ無効) */
    });
  });
}

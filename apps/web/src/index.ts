import { makeContext, retryPendingPushes, runDailyPull, staleAbandonedSessions } from '@ghs/core';
import { todayJst } from '@ghs/core/util/date';
import { Hono } from 'hono';
import { api } from './api/routes';
import { requireAuth } from './auth/gate';
import { auth } from './auth/routes';
import type { Env, HonoEnv } from './env';

const app = new Hono<HonoEnv>();

app.get('/healthz', (c) => c.json({ ok: true, app: 'logbook', todayJst: todayJst() }));

// 系統A: Google OIDC ログイン(/auth/login, /auth/callback, /auth/logout)。
app.route('/auth', auth);

// /api/* は認証ゲートの背後(系統A, §6.1)。
app.use('/api/*', requireAuth);
app.route('/api', api);

// SPA(/ 以下の非API)は assets バインドが配信(run_worker_first 対象外)。Worker catch-all は持たない。

export default {
  fetch: app.fetch,

  // daily batch(§12.2)。pull(日3回) と gh-push retry(*/30) を別スロットで処理。
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const app = makeContext(env);
    if (controller.cron === '*/30 * * * *') {
      // 軽量スロット: 失敗/未送の GH push を少数ずつ再送。
      ctx.waitUntil(retryPendingPushes(app, { max: 20 }).then(() => undefined));
      return;
    }
    // pull スロット: GH→D1 reconcile(own-write 除外, 冪等 upsert)+ 放置セッションの stale 化。
    ctx.waitUntil(
      (async () => {
        await staleAbandonedSessions(app.db);
        await runDailyPull(app);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

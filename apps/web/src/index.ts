import { todayJst } from '@ghs/core/util/date';
import { Hono } from 'hono';
import { api } from './api/routes';
import { requireAuth } from './auth/gate';
import type { Env, HonoEnv } from './env';

const app = new Hono<HonoEnv>();

app.get('/healthz', (c) => c.json({ ok: true, app: 'ghsidecar-web', todayJst: todayJst() }));

// /api/* は認証ゲートの背後(系統A, §6.1)。
app.use('/api/*', requireAuth);
app.route('/api', api);

// M1: /auth/* (Google OIDC ログイン)。callback 実装は UI 結線時。
app.all('/auth/*', (c) => c.text('auth: login flow (M1, 結線中)', 501));

// SPA(/ 以下の非API)は assets バインドが配信(run_worker_first 対象外)。Worker catch-all は持たない。

export default {
  fetch: app.fetch,

  // daily batch(§12.2)。pull(日3回) と gh-push retry(*/30) を別スロットで処理。
  async scheduled(
    controller: ScheduledController,
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (controller.cron === '*/30 * * * *') {
      // TODO(M2/M3): retryPendingGhPushes(env, { max: 20 })
      return;
    }
    // TODO(M0/M3): GoogleHealthProvider で §5.4 マスタ表の dataType を reconcile pull
    //   own-write フィルタ → mergeIntoStore(weight+body-fat は日付合流)。
    return;
  },
} satisfies ExportedHandler<Env>;

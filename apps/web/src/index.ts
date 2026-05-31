import { todayJst } from '@ghs/core/util/date';
import { Hono } from 'hono';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true, app: 'ghsidecar-web', todayJst: todayJst() }));

// M1: /auth/* (Google OIDC ゲート), /api/* (UIバックエンド) を実装。
app.all('/auth/*', (c) => c.text('auth: not implemented (M1)', 501));
app.all('/api/*', (c) => c.json({ error: 'not_implemented', milestone: 'M1' }, 501));

// SPA フォールバック(M1で assets バインド配信に置換)。
app.get('*', (c) => c.text('ghsidecar (UI is M1)', 200));

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

import {
  makeContext,
  pullStepsDaily,
  retryPendingPushes,
  runDailyPull,
  staleAbandonedSessions,
} from '@ghs/core';
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

  // 単一 cron(*/5)で pull(GH→D1)+ push再送 + stale化 を毎回実行(§12.2)。
  // cron 枠は account 合計5本制限のため「式」を1本に集約。同期頻度はこの1式の周期で決まる(枠は1のまま)。
  // pull は cursor 増分なので高頻度でも軽量(差分のみ)。通常 push は記録時に inline 送信、ここは失敗再送の保険。
  // 歩数の日次集計だけは重い(分単位intervalページング)ため、時刻ゲートで日3回(JST 07/13/22時)だけ実行。
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const app = makeContext(env);
    const jst = new Date(controller.scheduledTime + 9 * 3600_000);
    const stepsSlot = jst.getUTCMinutes() === 0 && [7, 13, 22].includes(jst.getUTCHours());
    ctx.waitUntil(
      (async () => {
        await staleAbandonedSessions(app.db);
        await runDailyPull(app); // GH→D1 reconcile(own-write 除外・冪等・cursor 増分)
        if (stepsSlot) await pullStepsDaily(app, { days: 2 }).catch(() => undefined); // 歩数=日次集計(重いので日3回)
        await retryPendingPushes(app, { max: 20 }); // 失敗/未送 push の再送
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

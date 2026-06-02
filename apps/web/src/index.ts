import {
  makeContext,
  pullActiveEnergyDaily,
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
    // 1日1回(早朝7時)だけ前日までの遅延到着分も広めに再集計。
    const catchupSlot = jst.getUTCMinutes() === 0 && jst.getUTCHours() === 7;
    ctx.waitUntil(
      (async () => {
        // 各段を独立に隔離(前段の throw で後段=特に push 再送(真実保全の核)がスキップされないように)。
        // 失敗は握りつぶさず console.error でログに残す(observability 有効 → dashboard / wrangler tail で
        // 後から点検して気づける)。隔離は維持(throw を飲んで後段は続行)。
        await staleAbandonedSessions(app.db).catch((e) =>
          console.error('[cron] staleAbandonedSessions failed:', e),
        );
        // GH→D1 reconcile(センシング: weight/sleep/HRV/皮膚温等。3日ルックバック・own-write除外・冪等)。
        // 個々の dataType 失敗は runDailyPull が sync_runs に記録 + errors[] で返すのでそれも出す。
        const pull = await runDailyPull(app).catch((e) => {
          console.error('[cron] runDailyPull threw:', e);
          return null;
        });
        if (pull?.errors.length) console.error('[cron] runDailyPull dataType errors:', pull.errors);
        // ※ 食事(nutrition)は GH→アプリの pull をしない。食事は app/MCP が D1 正本→GH push の一方向(§5.2)。
        // 分単位 interval の日次集計。pageSize 拡大(1000)で軽くなったため毎回(*/5)当日分を集計=高頻度。
        await pullStepsDaily(app, { days: catchupSlot ? 3 : 1 }).catch((e) =>
          console.error('[cron] pullStepsDaily failed:', e),
        );
        await pullActiveEnergyDaily(app, { days: catchupSlot ? 3 : 1 }).catch((e) =>
          console.error('[cron] pullActiveEnergyDaily failed:', e),
        );
        await retryPendingPushes(app, { max: 20 }).catch((e) =>
          console.error('[cron] retryPendingPushes failed:', e),
        ); // 失敗/未送 push の再送
      })(),
    );
  },
} satisfies ExportedHandler<Env>;

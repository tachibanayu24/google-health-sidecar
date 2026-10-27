import {
  type AppContext,
  pullActiveEnergyDaily,
  pullStepsDaily,
  retryPendingPushes,
  runDailyPull,
} from '@ghs/core';

/**
 * GH 同期パイプライン(sensing pull → 歩数/活動kcal 日次集計 → push 再送)。cron と手動同期(/api/sync)で共有。
 * 各段を独立に隔離(前段の throw で後段=特に push 再送(真実保全の核)がスキップされないように)。
 * 失敗は握りつぶさず console.error でログに残す(observability 有効 → dashboard / wrangler tail で点検)。
 * 戻り値の errors は失敗した段/dataType の一覧(手動同期で UI に返す)。
 */
export async function runGhSync(
  app: AppContext,
  opts: { days: number; label: string },
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const fail = (stage: string) => (e: unknown) => {
    console.error(`[${opts.label}] ${stage} failed:`, e);
    errors.push(stage);
    return null;
  };
  // GH→D1 reconcile(センシング: weight/sleep/HRV/皮膚温等。3日ルックバック・own-write除外・冪等)。
  // 個々の dataType 失敗は runDailyPull が sync_runs に記録 + errors[] で返すのでそれも出す。
  const pull = await runDailyPull(app).catch(fail('runDailyPull'));
  if (pull?.errors.length) {
    console.error(`[${opts.label}] runDailyPull dataType errors:`, pull.errors);
    errors.push(...pull.errors);
  }
  // ※ 食事(nutrition)は GH→アプリの pull をしない。食事は app/MCP が D1 正本→GH push の一方向(§5.2)。
  // 分単位 interval の日次集計。pageSize 拡大(1000)で軽くなったため毎回当日分を集計=高頻度。
  await pullStepsDaily(app, { days: opts.days }).catch(fail('pullStepsDaily'));
  await pullActiveEnergyDaily(app, { days: opts.days }).catch(fail('pullActiveEnergyDaily'));
  await retryPendingPushes(app, { max: 20 }).catch(fail('retryPendingPushes')); // 失敗/未送 push の再送
  return { errors };
}

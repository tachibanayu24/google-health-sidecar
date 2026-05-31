import {
  type GhDailyPoint,
  upsertDailyMetric,
  upsertGhBodyPoint,
  upsertGhSleep,
} from '../db/repositories/storage';
import {
  getPendingPushes,
  getSyncRun,
  isKnownOwnWrite,
  markSyncError,
  markSyncOk,
} from '../db/repositories/sync';
import type { DailyMetricKind } from '../domain/enums';
import { READ_DATATYPES, type ReadDataType } from '../providers/google-health/discovery-pin';
import type { ProviderDataPoint } from '../providers/HealthProvider';
import { jstDaysAgo, nowSec, toJstDateString } from '../util/date';
import { errorMessage } from '../util/errors';
import { type AppContext, getProvider } from './context';

/**
 * GH→D1 daily pull(§5.4 / §12.2)。READ_DATATYPES(GH dataType ID 粒度)を reconcile し、
 * own-write(自分の push)を除外して storage に冪等 upsert。sync_runs で再入。
 * ⚠ GH の実 pull はトークン取得後に契約テストで最終確認(§17.4 openItems)。
 */
export async function runDailyPull(
  ctx: AppContext,
  opts: { backfillDays?: number } = {},
): Promise<{ ok: string[]; errors: string[] }> {
  const provider = getProvider(ctx);
  const ok: string[] = [];
  const errors: string[] = [];
  const now = nowSec();

  for (const dt of READ_DATATYPES) {
    if (dt.unverified) continue; // dataType ID 未確定(resp-rate/skin-temp)は当面 skip(§5.4)
    try {
      const st = await getSyncRun(ctx.db, dt.ghDataType);
      const since =
        st?.last_synced_at ??
        Math.floor(Date.parse(`${jstDaysAgo(opts.backfillDays ?? 14)}T00:00:00Z`) / 1000);
      let cursor = st?.last_cursor ?? null;
      // ページングを cursor が尽きるまで(単一ユーザー1日分なら通常1ページ)。
      do {
        const { points, cursor: next } = await provider.reconcileDataPoints(
          dt.ghDataType,
          since,
          now,
          cursor,
        );
        for (const p of points) {
          if (await isKnownOwnWrite(ctx.db, p.id, p.dataOrigin)) continue; // echoループ防止(§5.4)
          await store(ctx, dt, p);
        }
        cursor = next;
      } while (cursor);
      await markSyncOk(ctx.db, dt.ghDataType, now, null);
      ok.push(dt.ghDataType);
    } catch (e) {
      await markSyncError(ctx.db, dt.ghDataType, errorMessage(e));
      errors.push(`${dt.ghDataType}: ${errorMessage(e)}`);
    }
  }
  return { ok, errors };
}

async function store(ctx: AppContext, dt: ReadDataType, p: ProviderDataPoint): Promise<void> {
  if (p.value == null && dt.store.kind !== 'sleep') return;
  const date = p.timeSec ? toJstDateString(p.timeSec * 1000) : toJstDateString();
  if (dt.store.kind === 'body_metric') {
    await upsertGhBodyPoint(ctx.db, {
      field: dt.store.field,
      value: p.value as number,
      measuredAtSec: p.timeSec || nowSec(),
      ghExternalId: p.id,
    });
  } else if (dt.store.kind === 'daily_metric') {
    const point: GhDailyPoint = {
      metric: dt.store.metric as DailyMetricKind,
      value: p.value as number,
      unit: dt.store.unit,
      date,
      ghExternalId: p.id || null,
    };
    await upsertDailyMetric(ctx.db, point);
  } else if (dt.store.kind === 'sleep') {
    const e = p.extra ?? {};
    await upsertGhSleep(ctx.db, {
      date,
      startAtSec: p.timeSec || nowSec(),
      endAtSec: p.timeSec || nowSec(),
      totalMin: e.total_min ?? 0,
      deepMin: e.deep_min ?? null,
      lightMin: e.light_min ?? null,
      remMin: e.rem_min ?? null,
      awakeMin: e.awake_min ?? null,
      efficiency: e.efficiency ?? null,
      ghExternalId: p.id,
    });
  }
}

/**
 * gh_sync_state の pending/failed を少数ずつ push(毎30分 cron スロット, §12.2)。
 * 実 push の再送はエンティティ別に payload を再構築する必要があるため、M1では
 * 「対象列挙 + ステータス可視化」までを実装し、再送本体は M2/M3 で services と結線する。
 */
export async function retryPendingPushes(
  ctx: AppContext,
  opts: { max?: number } = {},
): Promise<{ pending: number }> {
  const pending = await getPendingPushes(ctx.db, opts.max ?? 20);
  // TODO(M2/M3): entity_type 別に payload 再構築 → provider push → markPushSynced/Failed。
  //   workout=workout_sessions+sets からサマリ再構築、meal=meals+items 合算、body_metric=body_metrics。
  return { pending: pending.length };
}

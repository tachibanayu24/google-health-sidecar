import { getBodyMetricById } from '../db/repositories/body';
import { getMealById, getMealItems } from '../db/repositories/meals';
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
  markPushDeferred,
  markPushFailed,
  markPushSynced,
  markSyncError,
  markSyncOk,
} from '../db/repositories/sync';
import { getSessionPushData } from '../db/repositories/workouts';
import { type DailyMetricKind, MEAL_TYPE_TO_GH } from '../domain/enums';
import {
  buildReadFilter,
  READ_DATATYPES,
  type ReadDataType,
} from '../providers/google-health/discovery-pin';
import type { ProviderDataPoint } from '../providers/HealthProvider';
import { jstDaysAgo, nowSec, toJstDateString } from '../util/date';
import { errorMessage, ProviderApiError, RateLimitError } from '../util/errors';
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
      // 遅延到着対策: Fitbit→GH ミラーは数時間遅れ、睡眠の end_time は朝(=同期実行時刻より過去)。
      // since=last_synced_at(実行時刻)のままだと「実行時刻より過去の時刻を持つ後着データ」を恒久的に
      // 取りこぼす(今朝の睡眠が来ない実バグ)。最低3日は再スキャンする(own-write除外+upsertで冪等)。
      const firstSince = Math.floor(
        Date.parse(`${jstDaysAgo(opts.backfillDays ?? 14)}T00:00:00Z`) / 1000,
      );
      const since = Math.min(st?.last_synced_at ?? firstSince, now - 3 * 86400);
      let cursor = st?.last_cursor ?? null;
      const filter = buildReadFilter(dt, since, now);
      // ページングを cursor が尽きるまで(単一ユーザー1日分なら通常1ページ)。
      do {
        const { points, cursor: next } = await provider.reconcileDataPoints(
          dt.ghDataType,
          filter,
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
    const startAt = e.start_sec ?? p.timeSec ?? nowSec();
    // 起床時刻: GH interval.end を優先。無ければ start + 総睡眠分で近似(end==start 破損を防止)。
    const endAt = e.end_sec ?? startAt + (e.total_min ?? 0) * 60;
    await upsertGhSleep(ctx.db, {
      date,
      startAtSec: startAt,
      endAtSec: endAt,
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

// ※ 食事(nutrition)は GH→アプリの pull をしない方針(§5.2: 食事は app/MCP→D1正本→GH push の一方向)。
//   既存GH食事の一回限りバックフィルは tools 側で実施済。定期 pull は echo(MCP記録の二重取込)を生むため不採用。

/**
 * 分単位 interval 型(steps / active-energy-burned)の日次合計集計(§5.4)。直近数日分の interval を
 * reconcile し JST 日付で合算 → daily_metrics に overwrite。/5 cron 全部では重い(429/subrequest)ため
 * scheduled 側で日数回だけ呼ぶ(時刻ゲート)。cursor は使わず固定窓を毎回読み直して overwrite。
 */
async function pullIntervalDaily(
  ctx: AppContext,
  ghDataType: string,
  metric: DailyMetricKind,
  unit: string,
  opts: { days?: number },
): Promise<{ dates: number }> {
  const dt = READ_DATATYPES.find((d) => d.ghDataType === ghDataType);
  if (!dt) return { dates: 0 };
  const provider = getProvider(ctx);
  const now = nowSec();
  const since = Math.floor(Date.parse(`${jstDaysAgo(opts.days ?? 2)}T00:00:00Z`) / 1000);
  const filter = buildReadFilter(dt, since, now);
  const sums = new Map<string, number>();
  let cursor: string | null = null;
  do {
    const { points, cursor: next } = await provider.reconcileDataPoints(ghDataType, filter, cursor);
    for (const p of points) {
      if (p.value == null) continue;
      const date = toJstDateString((p.timeSec || now) * 1000);
      sums.set(date, (sums.get(date) ?? 0) + p.value);
    }
    cursor = next;
  } while (cursor);
  for (const [date, total] of sums) {
    await upsertDailyMetric(ctx.db, {
      metric,
      value: Math.round(total),
      unit,
      date,
      ghExternalId: null,
    });
  }
  return { dates: sums.size };
}

/** 歩数の日次合計(§5.4)。 */
export const pullStepsDaily = (ctx: AppContext, opts: { days?: number } = {}) =>
  pullIntervalDaily(ctx, 'steps', 'steps', 'count', opts);

/** 消費カロリー(active)の日次合計(§5.4・エネルギー収支)。GH `active-energy-burned`=分単位kcal。 */
export const pullActiveEnergyDaily = (ctx: AppContext, opts: { days?: number } = {}) =>
  pullIntervalDaily(ctx, 'active-energy-burned', 'active_energy_kcal', 'kcal', opts);

/**
 * gh_sync_state の pending/failed を少数ずつ push(毎30分 cron スロット, §12.2)。
 * エンティティ別に D1 から payload を再構築して push し、成否を台帳に反映(best-effort)。
 */
export async function retryPendingPushes(
  ctx: AppContext,
  opts: { max?: number } = {},
): Promise<{ attempted: number; synced: number; failed: number }> {
  const pending = await getPendingPushes(ctx.db, opts.max ?? 20);
  const provider = getProvider(ctx);
  let synced = 0;
  let failed = 0;

  for (const p of pending) {
    try {
      if (p.entity_type === 'workout') {
        const d = await getSessionPushData(ctx.db, p.entity_id);
        if (!d) continue;
        if (d.session.status !== 'completed') continue;
        const start = d.session.started_at;
        const end = d.session.ended_at ?? start + (d.session.active_duration_sec ?? 3600);
        const res = await provider.pushExercise({
          startSec: start,
          endSec: end,
          exerciseType: 'STRENGTH_TRAINING',
          displayName: d.session.title ?? 'Workout',
          activeDurationSec: d.session.active_duration_sec ?? Math.max(60, end - start),
          calories: d.session.est_calories,
          notes: d.note,
          clientTag: d.session.id,
        });
        await markPushSynced(ctx.db, 'workout', p.entity_id, res.datapointId, res.dataOrigin, null);
        synced++;
      } else if (p.entity_type === 'meal') {
        if (!ctx.featureGhNutritionPush) continue; // flag OFF は push しない
        const meal = await getMealById(ctx.db, p.entity_id);
        if (!meal) continue;
        const items = await getMealItems(ctx.db, p.entity_id);
        const sum = items.reduce(
          (a, it) => ({
            kcal: a.kcal + it.calories_kcal,
            pr: a.pr + it.protein_g,
            f: a.f + it.fat_g,
            c: a.c + it.carbs_g,
            na: a.na + (it.sodium_mg ?? 0),
            fiber: a.fiber + (it.fiber_g ?? 0),
            sugar: a.sugar + (it.sugar_g ?? 0),
          }),
          { kcal: 0, pr: 0, f: 0, c: 0, na: 0, fiber: 0, sugar: 0 },
        );
        const name = items.length === 1 && items[0] ? items[0].food_name : `${meal.meal_type}`;
        const res = await provider.pushNutrition({
          atSec: meal.logged_at,
          mealType: MEAL_TYPE_TO_GH[meal.meal_type],
          foodDisplayName: name,
          kcal: sum.kcal,
          proteinG: sum.pr,
          fatG: sum.f,
          carbsG: sum.c,
          sodiumMg: sum.na || undefined,
          fiberG: sum.fiber || undefined,
          sugarG: sum.sugar || undefined,
          clientTag: meal.id,
        });
        await markPushSynced(ctx.db, 'meal', p.entity_id, res.datapointId, res.dataOrigin, null);
        synced++;
      } else if (p.entity_type === 'body_metric') {
        const bm = await getBodyMetricById(ctx.db, p.entity_id);
        if (!bm) continue;
        if (bm.source !== 'app' || bm.weight_kg == null) continue;
        const res = await provider.pushBodyMetric({
          kind: 'weight',
          sampleTimeSec: bm.measured_at,
          weightKg: bm.weight_kg,
          clientTag: bm.id,
        });
        await markPushSynced(
          ctx.db,
          'body_metric',
          p.entity_id,
          res.datapointId,
          res.dataOrigin,
          null,
        );
        synced++;
      } else if (p.entity_type === 'body_metric_fat') {
        const bm = await getBodyMetricById(ctx.db, p.entity_id);
        if (!bm) continue;
        if (bm.source !== 'app' || bm.body_fat_pct == null) continue;
        const res = await provider.pushBodyMetric({
          kind: 'body-fat',
          sampleTimeSec: bm.measured_at,
          bodyFatPct: bm.body_fat_pct,
          clientTag: bm.id,
        });
        await markPushSynced(
          ctx.db,
          'body_metric_fat',
          p.entity_id,
          res.datapointId,
          res.dataOrigin,
          null,
        );
        synced++;
      }
    } catch (e) {
      if (e instanceof RateLimitError) {
        // レート制限は一時的。retry_count を消費せず次 cron に先送り(dead_letter 化を防ぐ)。
        await markPushDeferred(ctx.db, p.entity_type, p.entity_id, e.retryAfterSec);
      } else {
        // 403(scope不足/権限)・401・400 は恒久失敗 → 即 dead_letter。それ以外は指数バックオフ。
        const permanent = e instanceof ProviderApiError && [400, 401, 403].includes(e.status);
        await markPushFailed(ctx.db, p.entity_type, p.entity_id, errorMessage(e), { permanent });
      }
      failed++;
    }
  }
  return { attempted: pending.length, synced, failed };
}

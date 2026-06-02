import { insertStmt, runBatch } from '../db/batch-helpers';
import { ulid } from '../db/ids';
import { markPushFailed, markPushSynced, pendingPushStmt } from '../db/repositories/sync';
import type { WeightUnit } from '../domain/enums';
import { WRITE_DATATYPE } from '../providers/google-health/discovery-pin';
import { nowSec, toJstDateString } from '../util/date';
import { errorMessage } from '../util/errors';
import { toKg } from '../util/units';
import { type AppContext, getProvider } from './context';

export interface LogWeightInput {
  date?: string;
  measuredAtSec?: number;
  entryValue: number;
  entryUnit: WeightUnit;
  bodyFatPct?: number;
}

/**
 * 体重/体脂肪の手入力(source='app', D1正本, §2.1)。GH へ best-effort writeonly push。
 * デバイス測定は daily batch の pull 側(SyncService)で別途ミラー。
 */
export async function logWeight(
  ctx: AppContext,
  input: LogWeightInput,
): Promise<{ id: string; ghPushed: boolean }> {
  const now = nowSec();
  const id = ulid();
  const measuredAt = input.measuredAtSec ?? now;
  const date = input.date ?? toJstDateString(measuredAt * 1000);
  const weightKg = toKg(input.entryValue, input.entryUnit);

  const hasFat = input.bodyFatPct != null;
  const stmts = [
    insertStmt('body_metrics', {
      id,
      date,
      measured_at: measuredAt,
      entry_value: input.entryValue,
      entry_unit: input.entryUnit,
      weight_kg: weightKg,
      body_fat_pct: input.bodyFatPct ?? null,
      source: 'app',
      gh_external_id: null,
      created_at: now,
      updated_at: now,
    }),
    pendingPushStmt('body_metric', id),
  ];
  // 体脂肪は別 datapoint なので独立した push 台帳行で追跡(削除/再試行/echo判定を体重と分離)。
  if (hasFat) stmts.push(pendingPushStmt('body_metric_fat', id));
  await runBatch(ctx.db, stmts);

  let ghPushed = false;
  if (ctx.pushInline !== false) {
    const provider = getProvider(ctx);
    // 体重と体脂肪は独立した try/catch。片方の失敗がもう片方の synced 状態を上書きしない
    // (旧実装は体脂肪失敗で体重行を failed に巻き戻し→cron が体重を二重 push する不具合があった)。
    try {
      const res = await provider.pushBodyMetric({
        kind: 'weight',
        sampleTimeSec: measuredAt,
        weightKg,
        clientTag: id,
      });
      await markPushSynced(ctx.db, 'body_metric', id, res.datapointId, res.dataOrigin, null);
      ghPushed = true;
    } catch (e) {
      await markPushFailed(ctx.db, 'body_metric', id, errorMessage(e));
    }
    if (hasFat) {
      try {
        const bf = await provider.pushBodyMetric({
          kind: 'body-fat',
          sampleTimeSec: measuredAt,
          bodyFatPct: input.bodyFatPct as number,
          clientTag: id,
        });
        await markPushSynced(ctx.db, 'body_metric_fat', id, bf.datapointId, bf.dataOrigin, null);
      } catch (e) {
        await markPushFailed(ctx.db, 'body_metric_fat', id, errorMessage(e));
      }
    }
  }
  return { id, ghPushed };
}

/**
 * 体重/体脂肪の取消(§8.5)。D1 正本を削除し、GH に push 済みなら weight/body-fat datapoint を
 * best-effort で batchDelete。台帳(body_metric / body_metric_fat)も同 batch で削除。
 */
export async function deleteBodyMetric(
  ctx: AppContext,
  id: string,
): Promise<{ deleted: boolean; ghDeleted: boolean }> {
  const rows = await ctx.db.raw<{ entity_type: string; gh_datapoint_id: string | null }>(
    "SELECT entity_type, gh_datapoint_id FROM gh_sync_state WHERE entity_id=? AND entity_type IN ('body_metric','body_metric_fat')",
    id,
  );
  const weightDp = rows.find((r) => r.entity_type === 'body_metric')?.gh_datapoint_id ?? null;
  const fatDp = rows.find((r) => r.entity_type === 'body_metric_fat')?.gh_datapoint_id ?? null;
  let ghDeleted = false;
  const provider = getProvider(ctx);
  for (const [dpId, dataType] of [
    [weightDp, WRITE_DATATYPE.weight],
    [fatDp, WRITE_DATATYPE.bodyFat],
  ] as const) {
    if (!dpId) continue;
    try {
      await provider.batchDelete(dataType, [dpId]);
      ghDeleted = true;
    } catch {
      /* best-effort: GH 失敗でも D1 正本は削除 */
    }
  }
  await runBatch(ctx.db, [
    {
      sql: "DELETE FROM gh_sync_state WHERE entity_id=? AND entity_type IN ('body_metric','body_metric_fat')",
      binds: [id],
    },
    { sql: 'DELETE FROM body_metrics WHERE id=?', binds: [id] },
  ]);
  return { deleted: true, ghDeleted };
}

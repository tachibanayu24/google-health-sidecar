import { insertStmt, runBatch } from '../db/batch-helpers';
import { ulid } from '../db/ids';
import { markPushFailed, markPushSynced, pendingPushStmt } from '../db/repositories/sync';
import type { WeightUnit } from '../domain/enums';
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

  await runBatch(ctx.db, [
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
  ]);

  let ghPushed = false;
  if (ctx.pushInline !== false) {
    try {
      const provider = getProvider(ctx);
      const res = await provider.pushBodyMetric({
        kind: 'weight',
        sampleTimeSec: measuredAt,
        weightKg,
        clientTag: id,
      });
      await markPushSynced(ctx.db, 'body_metric', id, res.datapointId, res.dataOrigin, null);
      ghPushed = true;
      // 体脂肪も入力されていれば別 datapoint で push(best-effort)。
      if (input.bodyFatPct != null) {
        const bf = await provider.pushBodyMetric({
          kind: 'body-fat',
          sampleTimeSec: measuredAt,
          bodyFatPct: input.bodyFatPct,
          clientTag: id,
        });
        void bf;
      }
    } catch (e) {
      await markPushFailed(ctx.db, 'body_metric', id, errorMessage(e));
    }
  }
  return { id, ghPushed };
}

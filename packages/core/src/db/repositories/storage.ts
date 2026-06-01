import type { DailyMetricKind } from '../../domain/enums';
import { nowSec, toJstDateString } from '../../util/date';
import type { Db } from '../client';
import { ulid } from '../ids';

/**
 * GH→D1 pull のストレージ側(§5.4 / §12.2)。冪等 upsert。
 * own-write(自分が push した手入力)は呼び出し側で除外済み前提(§5.4 echoループ防止)。
 */

export interface GhBodyPoint {
  field: 'weight_kg' | 'body_fat_pct';
  value: number;
  measuredAtSec: number;
  ghExternalId: string;
}

/** 体重/体脂肪の GH ミラー upsert(gh_external_id で冪等)。
 *  weight と body-fat は別 dataType=別行で入り、read 層が date で coalesce する。 */
export async function upsertGhBodyPoint(db: Db, p: GhBodyPoint): Promise<void> {
  const date = toJstDateString(p.measuredAtSec * 1000);
  const existing = await db.raw<{ id: string }>(
    'SELECT id FROM body_metrics WHERE gh_external_id = ?',
    p.ghExternalId,
  );
  if (existing[0]) {
    await db.run(
      `UPDATE body_metrics SET ${p.field} = ?, measured_at = ?, updated_at = ? WHERE gh_external_id = ?`,
      p.value,
      p.measuredAtSec,
      nowSec(),
      p.ghExternalId,
    );
    return;
  }
  await db.run(
    `INSERT INTO body_metrics (id, date, measured_at, ${p.field}, source, gh_external_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'google_health', ?, ?, ?)`,
    ulid(),
    date,
    p.measuredAtSec,
    p.value,
    p.ghExternalId,
    nowSec(),
    nowSec(),
  );
}

export interface GhDailyPoint {
  metric: DailyMetricKind;
  value: number;
  unit: string;
  date: string;
  ghExternalId: string | null;
}

export async function upsertDailyMetric(db: Db, p: GhDailyPoint): Promise<void> {
  await db.run(
    `INSERT INTO daily_metrics (date, metric, value, unit, source, gh_external_id, updated_at)
     VALUES (?, ?, ?, ?, 'google_health', ?, ?)
     ON CONFLICT (date, metric) DO UPDATE SET
       value = excluded.value, unit = excluded.unit, gh_external_id = excluded.gh_external_id,
       updated_at = excluded.updated_at`,
    p.date,
    p.metric,
    p.value,
    p.unit,
    p.ghExternalId,
    nowSec(),
  );
}

export interface GhSleepPoint {
  date: string;
  startAtSec: number;
  endAtSec: number;
  totalMin: number;
  deepMin: number | null;
  lightMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
  efficiency: number | null;
  ghExternalId: string;
}

export async function upsertGhSleep(db: Db, p: GhSleepPoint): Promise<void> {
  await db.run(
    `INSERT INTO sleep_logs
       (id, date, start_at, end_at, total_min, deep_min, light_min, rem_min, awake_min, efficiency, source, gh_external_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'google_health', ?, ?, ?)
     ON CONFLICT (gh_external_id) WHERE gh_external_id IS NOT NULL DO UPDATE SET
       date=excluded.date, start_at=excluded.start_at, end_at=excluded.end_at, total_min=excluded.total_min,
       deep_min=excluded.deep_min, light_min=excluded.light_min, rem_min=excluded.rem_min,
       awake_min=excluded.awake_min, efficiency=excluded.efficiency, updated_at=excluded.updated_at`,
    ulid(),
    p.date,
    p.startAtSec,
    p.endAtSec,
    p.totalMin,
    p.deepMin,
    p.lightMin,
    p.remMin,
    p.awakeMin,
    p.efficiency,
    p.ghExternalId,
    nowSec(),
    nowSec(),
  );
}

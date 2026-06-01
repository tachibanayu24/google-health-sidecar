import type { WeightUnit } from '../../domain/enums';
import { BodyMetric } from '../../domain/models';
import { nowSec, toJstDateString } from '../../util/date';
import { toKg } from '../../util/units';
import type { Db } from '../client';
import { ulid } from '../ids';

/**
 * 体組成の手入力(source='app', D1正本)。デバイス測定の GH ミラーは storage.upsertGhBodyPoint(§2.1)。
 */
export interface ManualBodyInput {
  date?: string;
  measuredAtSec?: number;
  entryValue?: number;
  entryUnit?: WeightUnit;
  bodyFatPct?: number;
}

export async function insertManualBody(db: Db, input: ManualBodyInput): Promise<string> {
  const id = ulid();
  const measuredAt = input.measuredAtSec ?? nowSec();
  const date = input.date ?? toJstDateString(measuredAt * 1000);
  const weightKg =
    input.entryValue != null && input.entryUnit ? toKg(input.entryValue, input.entryUnit) : null;
  await db.run(
    `INSERT INTO body_metrics (id, date, measured_at, entry_value, entry_unit, weight_kg, body_fat_pct, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'app', ?, ?)`,
    id,
    date,
    measuredAt,
    input.entryValue ?? null,
    input.entryUnit ?? null,
    weightKg,
    input.bodyFatPct ?? null,
    nowSec(),
    nowSec(),
  );
  return id;
}

/** 日付の体組成(デバイス測定優先 = source='google_health' を先頭, §2.1 dedupe)。 */
export async function getBodyMetricsByDate(db: Db, date: string): Promise<BodyMetric[]> {
  return db.all(
    BodyMetric,
    `SELECT * FROM body_metrics WHERE date = ?
     ORDER BY CASE source WHEN 'google_health' THEN 0 ELSE 1 END, measured_at DESC`,
    date,
  );
}

export async function getBodyMetricById(db: Db, id: string): Promise<BodyMetric | null> {
  return db.one(BodyMetric, 'SELECT * FROM body_metrics WHERE id = ?', id);
}

export async function getLatestWeight(db: Db): Promise<BodyMetric | null> {
  return db.one(
    BodyMetric,
    'SELECT * FROM body_metrics WHERE weight_kg IS NOT NULL ORDER BY measured_at DESC LIMIT 1',
  );
}

// ============ センシング read(GH ミラー。Home ダッシュボード用) ============
export interface SleepSummaryRow {
  total_min: number;
  deep_min: number | null;
  light_min: number | null;
  rem_min: number | null;
  awake_min: number | null;
  efficiency: number | null;
}

/** その日付の睡眠(複数あれば end_at 最新)。 */
export async function getSleepByDate(db: Db, date: string): Promise<SleepSummaryRow | null> {
  const rows = await db.raw<SleepSummaryRow>(
    `SELECT total_min, deep_min, light_min, rem_min, awake_min, efficiency
     FROM sleep_logs WHERE date = ? ORDER BY end_at DESC LIMIT 1`,
    date,
  );
  return rows[0] ?? null;
}

export interface DailyMetricRow {
  metric: string;
  value: number;
  unit: string;
}

/** その日付のセンシング日次値(resting_hr/hrv_rmssd/spo2_avg/steps 等)。 */
export async function getDailyMetricsByDate(db: Db, date: string): Promise<DailyMetricRow[]> {
  return db.raw<DailyMetricRow>(
    'SELECT metric, value, unit FROM daily_metrics WHERE date = ? ORDER BY metric',
    date,
  );
}

// ============ 身体周径(body_measurements, §1.4 D1のみ) ============
export async function insertMeasurement(
  db: Db,
  p: { date: string; site: string; valueCm: number; note?: string | null },
): Promise<string> {
  const id = ulid();
  await db.run(
    'INSERT INTO body_measurements (id, date, site, value_cm, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    p.date,
    p.site,
    p.valueCm,
    p.note ?? null,
    nowSec(),
  );
  return id;
}

export interface MeasurementLatest {
  site: string;
  value_cm: number;
  date: string;
  prev_cm: number | null;
}

/** 部位ごとの最新値 + 直前値(増減表示用)。 */
export async function getLatestMeasurements(db: Db): Promise<MeasurementLatest[]> {
  return db.raw<MeasurementLatest>(
    `WITH ranked AS (
       SELECT site, value_cm, date,
              ROW_NUMBER() OVER (PARTITION BY site ORDER BY date DESC, created_at DESC) AS rn
         FROM body_measurements)
     SELECT a.site, a.value_cm, a.date,
            (SELECT b.value_cm FROM ranked b WHERE b.site = a.site AND b.rn = 2) AS prev_cm
       FROM ranked a WHERE a.rn = 1
      ORDER BY a.site`,
  );
}

export interface MeasurementPoint {
  date: string;
  value_cm: number;
}
/** 部位の時系列(トレンド)。 */
export async function getMeasurementHistory(db: Db, site: string): Promise<MeasurementPoint[]> {
  return db.raw<MeasurementPoint>(
    'SELECT date, value_cm FROM body_measurements WHERE site = ? ORDER BY date',
    site,
  );
}

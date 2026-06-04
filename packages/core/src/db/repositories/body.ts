import { BodyMetric } from '../../domain/models';
import type { Db } from '../client';

/** 手入力体組成 push の再構築用(retryPendingPushes)。 */
export async function getBodyMetricById(db: Db, id: string): Promise<BodyMetric | null> {
  return db.one(BodyMetric, 'SELECT * FROM body_metrics WHERE id = ?', id);
}

export interface BodyReading {
  weightKg: number | null;
  bodyFatPct: number | null;
  source: string | null;
  prevWeightKg: number | null; // 直近(前日以前)の体重=増減表示用
}

/** その日付の体組成を1測定にマージ(weight行とbody_fat行が別でも合成)+ 直近の前体重。device優先。 */
export async function getBodyForDate(db: Db, date: string): Promise<BodyReading> {
  const dev = "CASE source WHEN 'google_health' THEN 0 ELSE 1 END";
  const [w, f, prev] = await Promise.all([
    db.raw<{ weight_kg: number; source: string }>(
      `SELECT weight_kg, source FROM body_metrics WHERE date=? AND weight_kg IS NOT NULL ORDER BY ${dev}, measured_at DESC LIMIT 1`,
      date,
    ),
    db.raw<{ body_fat_pct: number }>(
      `SELECT body_fat_pct FROM body_metrics WHERE date=? AND body_fat_pct IS NOT NULL AND body_fat_pct > 0 ORDER BY ${dev}, measured_at DESC LIMIT 1`,
      date,
    ),
    db.raw<{ weight_kg: number }>(
      'SELECT weight_kg FROM body_metrics WHERE date < ? AND weight_kg IS NOT NULL ORDER BY date DESC, measured_at DESC LIMIT 1',
      date,
    ),
  ]);
  return {
    weightKg: w[0]?.weight_kg ?? null,
    bodyFatPct: f[0]?.body_fat_pct ?? null,
    source: w[0]?.source ?? null,
    prevWeightKg: prev[0]?.weight_kg ?? null,
  };
}

export interface BodyLogRow {
  id: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  source: string | null;
  measured_at: number;
}

/** その日付の体組成測定ログ(全行・マージしない)。からだ画面の一覧+削除用。 */
export async function getBodyLogByDate(db: Db, date: string): Promise<BodyLogRow[]> {
  return db.raw<BodyLogRow>(
    `SELECT id, weight_kg, body_fat_pct, source, measured_at
       FROM body_metrics WHERE date = ? ORDER BY measured_at DESC`,
    date,
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
  start_at: number;
  end_at: number;
}

/** その日付の主睡眠(複数行あれば最長=主睡眠を採用。昼寝に負けないよう total_min DESC)。 */
export async function getSleepByDate(db: Db, date: string): Promise<SleepSummaryRow | null> {
  const rows = await db.raw<SleepSummaryRow>(
    `SELECT total_min, deep_min, light_min, rem_min, awake_min, efficiency, start_at, end_at
     FROM sleep_logs WHERE date = ? ORDER BY total_min DESC LIMIT 1`,
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

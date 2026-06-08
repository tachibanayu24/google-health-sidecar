import { WeeklyReport } from '../../domain/models';
import type { Db } from '../client';

/**
 * 週次レポート(weekly_reports)リポジトリ(migration 0020 / docs/weekly-report-design.md)。
 * week_start(JST日曜)が自然キー。GH 非同期・gh_sync_state 非登録(routines と同じ WRITE_LOCAL)。
 */

export async function getWeeklyReportRow(db: Db, weekStart: string): Promise<WeeklyReport | null> {
  return db.one(WeeklyReport, 'SELECT * FROM weekly_reports WHERE week_start = ?', weekStart);
}

/** 最新(week_start 降順)の1件。get_weekly_report の既定。 */
export async function getLatestWeeklyReportRow(db: Db): Promise<WeeklyReport | null> {
  return db.one(WeeklyReport, 'SELECT * FROM weekly_reports ORDER BY week_start DESC LIMIT 1');
}

export async function listWeeklyReportRows(db: Db, limit: number): Promise<WeeklyReport[]> {
  return db.all(
    WeeklyReport,
    'SELECT * FROM weekly_reports ORDER BY week_start DESC LIMIT ?',
    limit,
  );
}

export interface WeeklyReportRowInput {
  week_start: string;
  week_end: string;
  overall_score: number | null;
  training_score: number | null;
  nutrition_score: number | null;
  recovery_score: number | null;
  body_score: number | null;
  headline: string;
  training_note: string | null;
  nutrition_note: string | null;
  recovery_note: string | null;
  body_note: string | null;
  focus_next_week: string | null;
  subjective_context: string | null;
  metrics_json: string;
}

/**
 * week_start で upsert(1週1レポート)。再保存は上書き(版管理しない)。
 * created_at は更新句から除外して初回時刻を保全、updated_at は明示更新(DEFAULT は INSERT 時のみ発火)。
 * D1 は単一 db.batch のみ原子性=この upsert は単一 statement に収める(§8.5)。
 */
export async function upsertWeeklyReportRow(db: Db, r: WeeklyReportRowInput): Promise<void> {
  await db.run(
    `INSERT INTO weekly_reports
       (week_start, week_end, overall_score, training_score, nutrition_score, recovery_score, body_score,
        headline, training_note, nutrition_note, recovery_note, body_note, focus_next_week,
        subjective_context, metrics_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(week_start) DO UPDATE SET
       week_end=excluded.week_end,
       overall_score=excluded.overall_score, training_score=excluded.training_score,
       nutrition_score=excluded.nutrition_score, recovery_score=excluded.recovery_score,
       body_score=excluded.body_score,
       headline=excluded.headline, training_note=excluded.training_note,
       nutrition_note=excluded.nutrition_note, recovery_note=excluded.recovery_note,
       body_note=excluded.body_note, focus_next_week=excluded.focus_next_week,
       subjective_context=excluded.subjective_context, metrics_json=excluded.metrics_json,
       updated_at=unixepoch()`,
    r.week_start,
    r.week_end,
    r.overall_score,
    r.training_score,
    r.nutrition_score,
    r.recovery_score,
    r.body_score,
    r.headline,
    r.training_note,
    r.nutrition_note,
    r.recovery_note,
    r.body_note,
    r.focus_next_week,
    r.subjective_context,
    r.metrics_json,
  );
}

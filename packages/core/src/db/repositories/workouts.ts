import type { WorkoutExercise, WorkoutSession, WorkoutSet } from '../../domain/models';
import { WorkoutSession as WorkoutSessionSchema } from '../../domain/models';
import { nowSec } from '../../util/date';
import { insertStmt, runBatch, type Stmt } from '../batch-helpers';
import type { Db } from '../client';

/**
 * ワークアウト永続化(§8.5: 多表書込みは単一 db.batch で原子的に)。
 * load_kg 等の集計は service(M1)が metrics.ts で計算し total_volume_kg を埋めて渡す。
 */

export interface SaveSessionInput {
  session: WorkoutSession;
  exercises: { exercise: WorkoutExercise; sets: WorkoutSet[] }[];
}

/** セッション+種目+セットを単一 batch で原子的に保存(§8.5)。 */
export async function saveSessionBatch(db: Db, input: SaveSessionInput): Promise<void> {
  const stmts: Stmt[] = [];
  stmts.push(insertStmt('workout_sessions', input.session as unknown as Record<string, unknown>));
  for (const { exercise, sets } of input.exercises) {
    stmts.push(insertStmt('workout_exercises', exercise as unknown as Record<string, unknown>));
    for (const s of sets) {
      stmts.push(insertStmt('workout_sets', s as unknown as Record<string, unknown>));
    }
  }
  await runBatch(db, stmts);
}

/** 派生(total_volume_kg / active_duration / est_calories)を再計算更新(§8.5: batch外で可)。 */
export async function updateSessionDerived(
  db: Db,
  sessionId: string,
  d: { totalVolumeKg: number; activeDurationSec: number | null; estCalories: number | null },
): Promise<void> {
  await db.run(
    `UPDATE workout_sessions SET total_volume_kg=?, active_duration_sec=?, est_calories=?, updated_at=? WHERE id=?`,
    d.totalVolumeKg,
    d.activeDurationSec,
    d.estCalories,
    nowSec(),
    sessionId,
  );
}

/** 中断再開(§9.3): in_progress の最新セッション。24h 超の放置は除外(バナーが残り続けない)。 */
export async function getInProgressSession(db: Db): Promise<WorkoutSession | null> {
  const cutoff = nowSec() - 24 * 60 * 60;
  return db.one(
    WorkoutSessionSchema,
    `SELECT * FROM workout_sessions WHERE status='in_progress' AND started_at > ? ORDER BY started_at DESC LIMIT 1`,
    cutoff,
  );
}

/** 24h 放置の in_progress を stale 化(§9.3)。 */
export async function staleAbandonedSessions(db: Db): Promise<number> {
  const cutoff = nowSec() - 24 * 60 * 60;
  const r = await db.run(
    `UPDATE workout_sessions SET status='stale', updated_at=? WHERE status='in_progress' AND started_at < ?`,
    nowSec(),
    cutoff,
  );
  return r.meta.changes ?? 0;
}

/** get_exercise_history(§10.4)の生行。service が metrics で load_kg/e1rm を付与。 */
export interface ExerciseHistoryRow {
  session_id: string;
  session_date: string;
  bodyweight_kg: number | null;
  set_id: string;
  set_index: number;
  set_type: string;
  load_mode: string;
  load_basis: string;
  is_bodyweight: number;
  bw_factor: number;
  entry_value: number | null;
  entry_unit: string;
  reps: number | null;
  rpe: number | null;
}

export async function getExerciseHistoryRows(
  db: Db,
  exerciseId: string,
  opts: { since?: string; limit?: number } = {},
): Promise<ExerciseHistoryRow[]> {
  const binds: unknown[] = [exerciseId];
  let dateFilter = '';
  if (opts.since) {
    dateFilter = 'AND s.date >= ?';
    binds.push(opts.since);
  }
  binds.push(Math.min(opts.limit ?? 500, 2000));
  return db.raw<ExerciseHistoryRow>(
    `SELECT s.id AS session_id, s.date AS session_date, s.bodyweight_kg AS bodyweight_kg,
            ws.id AS set_id, ws.set_index, ws.set_type, ws.load_mode, ws.entry_value, ws.entry_unit,
            ws.reps, ws.rpe, ex.load_basis, ex.is_bodyweight, ex.bw_factor
       FROM workout_sets ws
       JOIN workout_exercises we ON we.id = ws.workout_exercise_id
       JOIN workout_sessions s ON s.id = we.session_id
       JOIN exercises ex ON ex.id = we.exercise_id
      WHERE we.exercise_id = ? AND s.status != 'stale' ${dateFilter}
      ORDER BY s.date DESC, ws.set_index ASC
      LIMIT ?`,
    ...binds,
  );
}

/** GH push 再送用: セッション本体 + サマリ note を D1 から再構築(§12.2 retry)。 */
export interface SessionPushData {
  session: WorkoutSession;
  note: string;
}
export async function getSessionPushData(db: Db, id: string): Promise<SessionPushData | null> {
  const session = await db.one(
    WorkoutSessionSchema,
    'SELECT * FROM workout_sessions WHERE id = ?',
    id,
  );
  if (!session) return null;
  const rows = await db.raw<{
    name_ja: string | null;
    name_en: string;
    top_val: number | null;
    top_unit: string | null;
    top_reps: number | null;
    work_sets: number;
  }>(
    `SELECT ex.name_ja, ex.name_en,
       (SELECT s.entry_value FROM workout_sets s WHERE s.workout_exercise_id=we.id AND s.set_type!='warmup' ORDER BY s.set_index LIMIT 1) AS top_val,
       (SELECT s.entry_unit  FROM workout_sets s WHERE s.workout_exercise_id=we.id AND s.set_type!='warmup' ORDER BY s.set_index LIMIT 1) AS top_unit,
       (SELECT s.reps        FROM workout_sets s WHERE s.workout_exercise_id=we.id AND s.set_type!='warmup' ORDER BY s.set_index LIMIT 1) AS top_reps,
       (SELECT count(*)      FROM workout_sets s WHERE s.workout_exercise_id=we.id AND s.set_type!='warmup') AS work_sets
     FROM workout_exercises we JOIN exercises ex ON ex.id = we.exercise_id
     WHERE we.session_id = ? ORDER BY we.order_index`,
    id,
  );
  const note = rows
    .map((r) => {
      const name = r.name_ja ?? r.name_en;
      return r.top_val != null
        ? `${name} ${r.top_val}${r.top_unit ?? ''}×${r.top_reps ?? '?'}×${r.work_sets}`
        : name;
    })
    .join('; ');
  return { session, note };
}

/** 部位別ボリューム集計の素データ(§8.3)。service が metrics + contribution で stimulus 化。 */
export interface WindowSetRow extends ExerciseHistoryRow {
  exercise_id: string;
}

export async function getWindowSets(db: Db, sinceDate: string): Promise<WindowSetRow[]> {
  return db.raw<WindowSetRow>(
    `SELECT s.id AS session_id, s.date AS session_date, s.bodyweight_kg AS bodyweight_kg,
            ws.id AS set_id, ws.set_index, ws.set_type, ws.load_mode, ws.entry_value, ws.entry_unit,
            ws.reps, ws.rpe, ex.id AS exercise_id, ex.load_basis, ex.is_bodyweight, ex.bw_factor
       FROM workout_sets ws
       JOIN workout_exercises we ON we.id = ws.workout_exercise_id
       JOIN workout_sessions s ON s.id = we.session_id
       JOIN exercises ex ON ex.id = we.exercise_id
      WHERE s.date >= ? AND s.status != 'stale'`,
    sinceDate,
  );
}

// ============ セッション一覧 / 削除 / PR(History 画面) ============
export interface RecentSessionRow {
  id: string;
  date: string;
  title: string | null;
  total_volume_kg: number;
  est_calories: number | null;
  exercises: number;
  sets: number;
}

/** 直近のワークアウトセッション(完了済)。Home/History の履歴リスト用。 */
export async function getRecentSessions(db: Db, limit = 30): Promise<RecentSessionRow[]> {
  return db.raw<RecentSessionRow>(
    `SELECT s.id, s.date, s.title, s.total_volume_kg, s.est_calories,
            (SELECT count(*) FROM workout_exercises we WHERE we.session_id = s.id) AS exercises,
            (SELECT count(*) FROM workout_sets ws
               JOIN workout_exercises we ON we.id = ws.workout_exercise_id
               WHERE we.session_id = s.id) AS sets
       FROM workout_sessions s
      WHERE s.status = 'completed'
      ORDER BY s.started_at DESC LIMIT ?`,
    limit,
  );
}

/** D1 からセッション削除(workout_exercises/sets は ON DELETE CASCADE)。public は services.deleteWorkout。 */
export async function deleteSessionRow(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM workout_sessions WHERE id = ?', id);
}

export interface SessionDetailRow {
  id: string;
  date: string;
  title: string | null;
  bodyweight_kg: number | null;
  exercise_id: string;
  name_en: string;
  name_ja: string | null;
  order_index: number;
  superset_group: number | null;
  set_index: number;
  set_type: string;
  entry_value: number | null;
  entry_unit: string;
  reps: number | null;
  rpe: number | null;
}

/** セッション詳細(種目×セットを平坦行で)。in-place 編集のプレフィル用。 */
export async function getSessionDetail(db: Db, id: string): Promise<SessionDetailRow[]> {
  return db.raw<SessionDetailRow>(
    `SELECT s.id, s.date, s.title, s.bodyweight_kg,
            we.exercise_id, ex.name_en, ex.name_ja, we.order_index, we.superset_group,
            ws.set_index, ws.set_type, ws.entry_value, ws.entry_unit, ws.reps, ws.rpe
       FROM workout_sessions s
       JOIN workout_exercises we ON we.session_id = s.id
       JOIN exercises ex ON ex.id = we.exercise_id
       LEFT JOIN workout_sets ws ON ws.workout_exercise_id = we.id
      WHERE s.id = ?
      ORDER BY we.order_index, ws.set_index`,
    id,
  );
}

export interface PrRow {
  exercise_id: string;
  name_ja: string | null;
  name_en: string;
  value: number;
  rep_bucket: number | null;
  pr_basis: string | null;
  achieved_at: number;
}

/** 直近の e1RM PR(種目名つき)。PR タイムライン用。 */
export async function getRecentPrs(db: Db, limit = 20): Promise<PrRow[]> {
  return db.raw<PrRow>(
    `SELECT pr.exercise_id, ex.name_ja, ex.name_en, pr.value, pr.rep_bucket, pr.pr_basis, pr.achieved_at
       FROM personal_records pr JOIN exercises ex ON ex.id = pr.exercise_id
      WHERE pr.record_type = 'e1rm'
      ORDER BY pr.achieved_at DESC LIMIT ?`,
    limit,
  );
}

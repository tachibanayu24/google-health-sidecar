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

/** 中断再開(§9.3): in_progress の最新セッション。 */
export async function getInProgressSession(db: Db): Promise<WorkoutSession | null> {
  return db.one(
    WorkoutSessionSchema,
    `SELECT * FROM workout_sessions WHERE status='in_progress' ORDER BY started_at DESC LIMIT 1`,
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

import {
  aggregateRoutineMuscles,
  type RoutineMuscle,
  representativeSets,
} from '../../domain/routine';
import { nowSec } from '../../util/date';
import { insertStmt, runBatch, type Stmt, stmt } from '../batch-helpers';
import type { Db } from '../client';
import { ulid } from '../ids';
import { getExerciseMusclesForExercises } from './exercises';

/**
 * AI作成トレーニングルーティン(計画・参照専用)。MCPでCRUD・Webで参照(§8.10)。
 * 種目は exercises の FK 必須。人体図は exercise_muscles 経由で日ごとに集計。
 */

export interface RoutineSummary {
  id: string;
  name: string;
  goal: string | null;
  is_active: boolean;
  day_count: number;
  updated_at: number;
}

export interface RoutineExerciseDetail {
  id: string;
  position: number;
  exercise_id: string;
  exercise_name: string | null;
  alt_exercise_id: string | null;
  alt_exercise_name: string | null;
  sets_min: number | null;
  sets_max: number | null;
  reps_min: number | null;
  reps_max: number | null;
  target_load: string | null;
  note: string | null;
}

export interface RoutineDayDetail {
  id: string;
  position: number;
  label: string | null;
  title: string;
  aim: string | null;
  main_lift: string | null;
  is_rest: boolean;
  note: string | null;
  exercises: RoutineExerciseDetail[];
  muscles: RoutineMuscle[]; // 人体図用(その日の部位別 intensity)
}

export interface RoutineDetail {
  id: string;
  name: string;
  goal: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: number;
  updated_at: number;
  days: RoutineDayDetail[];
}

export interface SaveRoutineExercise {
  exerciseId: string;
  altExerciseId?: string | null;
  setsMin?: number | null;
  setsMax?: number | null;
  repsMin?: number | null;
  repsMax?: number | null;
  targetLoad?: string | null;
  note?: string | null;
}
export interface SaveRoutineDay {
  label?: string | null;
  title: string;
  aim?: string | null;
  mainLift?: string | null;
  isRest?: boolean;
  note?: string | null;
  exercises?: SaveRoutineExercise[];
}
export interface SaveRoutineInput {
  id?: string; // 省略=新規、指定=全置換(編集)
  name: string;
  goal?: string | null;
  notes?: string | null;
  isActive?: boolean;
  days: SaveRoutineDay[];
}

export async function getRoutines(db: Db): Promise<RoutineSummary[]> {
  const rows = await db.raw<{
    id: string;
    name: string;
    goal: string | null;
    is_active: number;
    day_count: number;
    updated_at: number;
  }>(
    `SELECT r.id, r.name, r.goal, r.is_active, r.updated_at,
            (SELECT COUNT(*) FROM routine_days d WHERE d.routine_id = r.id) AS day_count
       FROM routines r ORDER BY r.is_active DESC, r.updated_at DESC`,
  );
  return rows.map((r) => ({ ...r, is_active: r.is_active === 1 }));
}

export async function getRoutine(db: Db, id: string): Promise<RoutineDetail | null> {
  const head = await db.raw<{
    id: string;
    name: string;
    goal: string | null;
    notes: string | null;
    is_active: number;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM routines WHERE id = ?', id);
  if (!head[0]) return null;

  const dayRows = await db.raw<{
    id: string;
    position: number;
    label: string | null;
    title: string;
    aim: string | null;
    main_lift: string | null;
    is_rest: number;
    note: string | null;
  }>('SELECT * FROM routine_days WHERE routine_id = ? ORDER BY position', id);

  const exRows = await db.raw<{
    id: string;
    day_id: string;
    position: number;
    exercise_id: string;
    exercise_name: string | null;
    alt_exercise_id: string | null;
    alt_exercise_name: string | null;
    sets_min: number | null;
    sets_max: number | null;
    reps_min: number | null;
    reps_max: number | null;
    target_load: string | null;
    note: string | null;
  }>(
    `SELECT re.id, re.day_id, re.position, re.exercise_id,
            ex.name_ja AS exercise_name, re.alt_exercise_id, alt.name_ja AS alt_exercise_name,
            re.sets_min, re.sets_max, re.reps_min, re.reps_max, re.target_load, re.note
       FROM routine_exercises re
       JOIN routine_days d ON d.id = re.day_id
       LEFT JOIN exercises ex ON ex.id = re.exercise_id
       LEFT JOIN exercises alt ON alt.id = re.alt_exercise_id
      WHERE d.routine_id = ?
      ORDER BY re.day_id, re.position`,
    id,
  );

  // 人体図用に全種目の部位リンクを一括ロード。
  const links = await getExerciseMusclesForExercises(db, [
    ...new Set(exRows.map((e) => e.exercise_id)),
  ]);
  const exByDay = new Map<string, RoutineExerciseDetail[]>();
  for (const e of exRows) {
    const list = exByDay.get(e.day_id) ?? [];
    list.push({
      id: e.id,
      position: e.position,
      exercise_id: e.exercise_id,
      exercise_name: e.exercise_name,
      alt_exercise_id: e.alt_exercise_id,
      alt_exercise_name: e.alt_exercise_name,
      sets_min: e.sets_min,
      sets_max: e.sets_max,
      reps_min: e.reps_min,
      reps_max: e.reps_max,
      target_load: e.target_load,
      note: e.note,
    });
    exByDay.set(e.day_id, list);
  }

  const days: RoutineDayDetail[] = dayRows.map((d) => {
    const exercises = exByDay.get(d.id) ?? [];
    const muscles = aggregateRoutineMuscles(
      exercises.map((e) => ({
        exercise_id: e.exercise_id,
        sets: representativeSets(e.sets_min, e.sets_max),
      })),
      links,
    );
    return {
      id: d.id,
      position: d.position,
      label: d.label,
      title: d.title,
      aim: d.aim,
      main_lift: d.main_lift,
      is_rest: d.is_rest === 1,
      note: d.note,
      exercises,
      muscles,
    };
  });

  const h = head[0];
  return {
    id: h.id,
    name: h.name,
    goal: h.goal,
    notes: h.notes,
    is_active: h.is_active === 1,
    created_at: h.created_at,
    updated_at: h.updated_at,
    days,
  };
}

/**
 * ルーティンを upsert(id 省略=新規 / 指定=全置換)。全文を単一 batch で原子的に書く(§8.5)。
 * exerciseId は exercises FK で担保(未存在は batch 失敗)。isActive=true は他を 0 にする(同時に1つだけ)。
 */
export async function saveRoutine(db: Db, input: SaveRoutineInput): Promise<{ id: string }> {
  const id = input.id ?? ulid();
  const now = nowSec();
  const stmts: Stmt[] = [];

  if (input.id) {
    // 編集: 本体を更新し、日(=CASCADE で種目も)を消して作り直す。
    stmts.push(
      stmt(
        'UPDATE routines SET name = ?, goal = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?',
        input.name,
        input.goal ?? null,
        input.notes ?? null,
        input.isActive ? 1 : 0,
        now,
        id,
      ),
      stmt('DELETE FROM routine_days WHERE routine_id = ?', id),
    );
  } else {
    stmts.push(
      insertStmt('routines', {
        id,
        name: input.name,
        goal: input.goal ?? null,
        notes: input.notes ?? null,
        is_active: input.isActive ? 1 : 0,
        created_at: now,
        updated_at: now,
      }),
    );
  }

  // isActive=true のとき他ルーティンを非アクティブ化(自分は上で設定済み)。
  if (input.isActive) {
    stmts.push(stmt('UPDATE routines SET is_active = 0 WHERE id != ?', id));
  }

  input.days.forEach((d, di) => {
    const dayId = ulid();
    stmts.push(
      insertStmt('routine_days', {
        id: dayId,
        routine_id: id,
        position: di + 1,
        label: d.label ?? null,
        title: d.title,
        aim: d.aim ?? null,
        main_lift: d.mainLift ?? null,
        is_rest: d.isRest ? 1 : 0,
        note: d.note ?? null,
      }),
    );
    (d.exercises ?? []).forEach((e, ei) => {
      stmts.push(
        insertStmt('routine_exercises', {
          id: ulid(),
          day_id: dayId,
          position: ei + 1,
          exercise_id: e.exerciseId,
          alt_exercise_id: e.altExerciseId ?? null,
          sets_min: e.setsMin ?? null,
          sets_max: e.setsMax ?? null,
          reps_min: e.repsMin ?? null,
          reps_max: e.repsMax ?? null,
          target_load: e.targetLoad ?? null,
          note: e.note ?? null,
        }),
      );
    });
  });

  await runBatch(db, stmts);
  return { id };
}

export async function deleteRoutine(db: Db, id: string): Promise<{ deleted: boolean }> {
  const res = await db.run('DELETE FROM routines WHERE id = ?', id);
  return { deleted: (res.meta?.changes ?? 0) > 0 };
}

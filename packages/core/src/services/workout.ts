import { insertStmt, runBatch, type Stmt } from '../db/batch-helpers';
import { ulid } from '../db/ids';
import {
  getExerciseMuscles,
  listMuscleGroups,
  resolveExercise,
} from '../db/repositories/exercises';
import { getSettings } from '../db/repositories/settings';
import { markPushFailed, markPushSynced, pendingPushStmt } from '../db/repositories/sync';
import {
  getExerciseHistoryRows,
  getWindowSets,
  type WindowSetRow,
} from '../db/repositories/workouts';
import type { LoadMode, SetType, WeightUnit } from '../domain/enums';
import {
  computeE1rmKg,
  computeLoadKg,
  computeSetVolumeKg,
  countsTowardVolume,
  estStrengthCaloriesKcal,
  isProvisional,
  prBasisOf,
  recencyDecay,
  setTypeStimulusWeight,
} from '../domain/metrics';
import type { Exercise, ExerciseHistorySet, MuscleVolume } from '../domain/models';
import { jstDaysAgo, nowSec, todayJst } from '../util/date';
import { errorMessage } from '../util/errors';
import { toKg } from '../util/units';
import { type AppContext, getProvider } from './context';

export interface SaveSetInput {
  setType?: SetType;
  loadMode?: LoadMode;
  entryValue?: number | null;
  entryUnit?: WeightUnit;
  reps?: number | null;
  rpe?: number | null;
  restSec?: number | null;
  performedAtSec?: number | null;
}
export interface SaveWorkoutInput {
  date?: string;
  title?: string;
  startedAtSec?: number;
  endedAtSec?: number;
  bodyweightKg?: number | null;
  status?: 'in_progress' | 'completed';
  exercises: Array<{ exerciseId: string; note?: string; sets: SaveSetInput[] }>;
}

/**
 * ワークアウト保存(§8.5: セッション+種目+セット+gh_sync pending を単一 batch で原子的に)。
 * 派生(PR)は保存後に再計算。GH push はサマリを best-effort(D1正本に影響させない)。
 */
export async function saveWorkout(
  ctx: AppContext,
  input: SaveWorkoutInput,
): Promise<{ sessionId: string; totalVolumeKg: number; newPrs: string[] }> {
  const now = nowSec();
  const date = input.date ?? todayJst();
  const startedAt = input.startedAtSec ?? now;
  const sessionId = ulid();
  const bodyweightKg = input.bodyweightKg ?? null;

  // 種目メタを一括解決(load_basis/bw_factor/is_bodyweight)。
  const metaCache = new Map<string, Exercise>();
  for (const ex of input.exercises) {
    if (!metaCache.has(ex.exerciseId)) {
      metaCache.set(ex.exerciseId, await resolveExercise(ctx.db, ex.exerciseId));
    }
  }

  const stmts: Stmt[] = [];
  let totalVolumeKg = 0;
  // PR検知用に (exerciseId, set行) を貯める。
  const prCandidates: Array<{
    exerciseId: string;
    setId: string;
    loadKg: number;
    reps: number | null;
    setType: SetType;
    rpe: number | null;
  }> = [];

  input.exercises.forEach((ex, exIdx) => {
    const meta = metaCache.get(ex.exerciseId)!;
    const weId = ulid();
    stmts.push(
      insertStmt('workout_exercises', {
        id: weId,
        session_id: sessionId,
        exercise_id: ex.exerciseId,
        order_index: exIdx,
        superset_group: null,
        note: ex.note ?? null,
      }),
    );
    ex.sets.forEach((s, setIdx) => {
      const setType = s.setType ?? 'main';
      const loadMode = s.loadMode ?? (meta.is_bodyweight ? 'bodyweight' : 'weighted');
      const entryUnit = s.entryUnit ?? 'kg';
      const entryValue = s.entryValue ?? null;
      const weightKg = entryValue != null ? toKg(entryValue, entryUnit) : null;
      const loadKg = computeLoadKg({
        loadMode,
        entryValue,
        entryUnit,
        loadBasis: meta.load_basis,
        isBodyweight: meta.is_bodyweight,
        bwFactor: meta.bw_factor,
        bodyweightKg,
      });
      const setId = ulid();
      stmts.push(
        insertStmt('workout_sets', {
          id: setId,
          workout_exercise_id: weId,
          set_index: setIdx,
          set_type: setType,
          load_mode: loadMode,
          entry_value: entryValue,
          entry_unit: entryUnit,
          weight_kg: weightKg,
          reps: s.reps ?? null,
          rpe: s.rpe ?? null,
          rest_sec: s.restSec ?? null,
          is_completed: 1,
          performed_at: s.performedAtSec ?? null,
          created_at: now,
        }),
      );
      if (countsTowardVolume(setType)) totalVolumeKg += computeSetVolumeKg(loadKg, s.reps ?? null);
      prCandidates.push({
        exerciseId: ex.exerciseId,
        setId,
        loadKg,
        reps: s.reps ?? null,
        setType,
        rpe: s.rpe ?? null,
      });
    });
  });

  const activeDurationSec = input.endedAtSec ? input.endedAtSec - startedAt : null;
  const estCalories = estStrengthCaloriesKcal(bodyweightKg, activeDurationSec);
  const status = input.status ?? 'completed';

  // セッション本体(子より先頭でなくとも単一 batch 内なら参照整合は確保される)。
  stmts.unshift(
    insertStmt('workout_sessions', {
      id: sessionId,
      date,
      started_at: startedAt,
      ended_at: input.endedAtSec ?? null,
      title: input.title ?? null,
      template_id: null,
      note: null,
      bodyweight_kg: bodyweightKg,
      total_volume_kg: Math.round(totalVolumeKg * 100) / 100,
      active_duration_sec: activeDurationSec,
      est_calories: estCalories,
      status,
      source: 'app',
      created_at: now,
      updated_at: now,
    }),
  );

  // GH push 台帳: completed のみ pending(in_progress は完了時に push)。
  if (status === 'completed') {
    stmts.push(pendingPushStmt('workout', sessionId));
  }

  await runBatch(ctx.db, stmts); // ★原子的

  // 派生: PR検知(保存後・非batch, §8.5)。
  const newPrs = await detectE1rmPrs(ctx, prCandidates, now);

  // GH push(best-effort, completed のみ)。
  if (status === 'completed' && ctx.pushInline !== false) {
    await pushWorkoutSummary(ctx, {
      sessionId,
      startedAt,
      endedAt: input.endedAtSec ?? now,
      activeDurationSec: activeDurationSec ?? Math.max(60, now - startedAt),
      estCalories,
      title: input.title ?? 'Workout',
      summary: buildSummaryNote(input, metaCache),
    });
  }

  return { sessionId, totalVolumeKg: Math.round(totalVolumeKg * 100) / 100, newPrs };
}

function buildSummaryNote(input: SaveWorkoutInput, meta: Map<string, Exercise>): string {
  return input.exercises
    .map((ex) => {
      const name =
        meta.get(ex.exerciseId)?.name_ja ?? meta.get(ex.exerciseId)?.name_en ?? ex.exerciseId;
      const work = ex.sets.filter((s) => (s.setType ?? 'main') !== 'warmup');
      const top = work[0];
      return top ? `${name} ${top.entryValue ?? 'BW'}×${top.reps ?? '?'}×${work.length}` : name;
    })
    .join('; ');
}

async function detectE1rmPrs(
  ctx: AppContext,
  candidates: Array<{
    exerciseId: string;
    setId: string;
    loadKg: number;
    reps: number | null;
    setType: SetType;
    rpe: number | null;
  }>,
  at: number,
): Promise<string[]> {
  const newPrs: string[] = [];
  // 種目ごとに最良 e1RM のセットを抽出。
  const bestByExercise = new Map<
    string,
    { setId: string; e1rm: number; setType: SetType; rpe: number | null }
  >();
  for (const c of candidates) {
    const e1rm = computeE1rmKg(c.loadKg, c.reps);
    if (e1rm == null) continue;
    const prev = bestByExercise.get(c.exerciseId);
    if (!prev || e1rm > prev.e1rm)
      bestByExercise.set(c.exerciseId, { setId: c.setId, e1rm, setType: c.setType, rpe: c.rpe });
  }
  for (const [exerciseId, best] of bestByExercise) {
    const rows = await ctx.db.raw<{ value: number }>(
      `SELECT value FROM personal_records WHERE exercise_id=? AND record_type='e1rm' ORDER BY value DESC LIMIT 1`,
      exerciseId,
    );
    const prevBest = rows[0]?.value ?? 0;
    if (best.e1rm > prevBest) {
      const basis = prBasisOf(best.setType, best.rpe);
      await ctx.db.run(
        `INSERT INTO personal_records (id, exercise_id, record_type, value, unit, is_provisional, pr_basis, achieved_set_id, achieved_at)
         VALUES (?, ?, 'e1rm', ?, 'kg', ?, ?, ?, ?)`,
        ulid(),
        exerciseId,
        best.e1rm,
        isProvisional(basis) ? 1 : 0,
        basis,
        best.setId,
        at,
      );
      newPrs.push(exerciseId);
    }
  }
  return newPrs;
}

async function pushWorkoutSummary(
  ctx: AppContext,
  s: {
    sessionId: string;
    startedAt: number;
    endedAt: number;
    activeDurationSec: number;
    estCalories: number | null;
    title: string;
    summary: string;
  },
): Promise<void> {
  try {
    const provider = getProvider(ctx);
    const res = await provider.pushExercise({
      startSec: s.startedAt,
      endSec: s.endedAt,
      exerciseType: 'STRENGTH_TRAINING',
      displayName: s.title,
      activeDurationSec: s.activeDurationSec,
      calories: s.estCalories,
      notes: s.summary,
      clientTag: s.sessionId,
    });
    await markPushSynced(ctx.db, 'workout', s.sessionId, res.datapointId, res.dataOrigin, null);
  } catch (e) {
    await markPushFailed(ctx.db, 'workout', s.sessionId, errorMessage(e)); // 失敗は cron で再試行
  }
}

// ============ reads(トレーナーAI/UI 用, §10.4) ============

/** get_exercise_history: 生セット + 計算済み(load_kg/set_volume/e1rm)を返す。 */
export async function getExerciseHistory(
  ctx: AppContext,
  exerciseId: string,
  opts: { since?: string; limit?: number } = {},
): Promise<ExerciseHistorySet[]> {
  const settings = await getSettings(ctx.db);
  const rows = await getExerciseHistoryRows(ctx.db, exerciseId, opts);
  return rows.map((r) => {
    const loadKg = computeLoadKg({
      loadMode: r.load_mode as LoadMode,
      entryValue: r.entry_value,
      entryUnit: r.entry_unit as WeightUnit,
      loadBasis: r.load_basis as never,
      isBodyweight: r.is_bodyweight === 1,
      bwFactor: r.bw_factor,
      bodyweightKg: r.bodyweight_kg,
    });
    return {
      id: r.set_id,
      workout_exercise_id: '',
      set_index: r.set_index,
      set_type: r.set_type as SetType,
      load_mode: r.load_mode as LoadMode,
      entry_value: r.entry_value,
      entry_unit: r.entry_unit as WeightUnit,
      weight_kg: r.entry_value != null ? toKg(r.entry_value, r.entry_unit as WeightUnit) : null,
      reps: r.reps,
      rpe: r.rpe,
      rest_sec: null,
      is_completed: true,
      performed_at: null,
      created_at: 0,
      session_id: r.session_id,
      session_date: r.session_date,
      load_kg: Math.round(loadKg * 100) / 100,
      set_volume_kg: computeSetVolumeKg(loadKg, r.reps),
      e1rm_kg: computeE1rmKg(loadKg, r.reps, settings.e1rm_formula),
    };
  });
}

/** get_muscle_volume: 直近 window 日の部位別 stimulus(ヒートマップ, §8.3)。 */
export async function getMuscleVolume(
  ctx: AppContext,
  opts: { windowDays?: number } = {},
): Promise<MuscleVolume[]> {
  const windowDays = opts.windowDays ?? 7;
  const since = jstDaysAgo(windowDays);
  const today = todayJst();
  const [sets, groups] = await Promise.all([
    getWindowSets(ctx.db, since),
    listMuscleGroups(ctx.db),
  ]);

  // 種目→部位(role/contribution)を一括ロード。
  const muscleByExercise = new Map<
    string,
    Array<{ muscle: string; role: string; contribution: number }>
  >();
  for (const exId of new Set(sets.map((s) => s.exercise_id))) {
    const ms = await getExerciseMuscles(ctx.db, exId);
    muscleByExercise.set(
      exId,
      ms.map((m) => ({ muscle: m.muscle_group_id, role: m.role, contribution: m.contribution })),
    );
  }

  const acc = new Map<string, { sets: number; volume: number; stimulus: number }>();
  for (const s of sets) {
    const loadKg = loadKgOf(s);
    const vol = countsTowardVolume(s.set_type as SetType) ? computeSetVolumeKg(loadKg, s.reps) : 0;
    const daysAgo = daysBetween(s.session_date, today);
    const decay = recencyDecay(daysAgo, windowDays);
    const stim = vol * setTypeStimulusWeight(s.set_type as SetType) * decay;
    for (const link of muscleByExercise.get(s.exercise_id) ?? []) {
      const a = acc.get(link.muscle) ?? { sets: 0, volume: 0, stimulus: 0 };
      a.sets += countsTowardVolume(s.set_type as SetType) ? 1 : 0;
      a.volume += vol * link.contribution;
      a.stimulus += stim * link.contribution;
      acc.set(link.muscle, a);
    }
  }
  const maxStim = Math.max(1, ...[...acc.values()].map((v) => v.stimulus));
  return groups.map((g) => {
    const a = acc.get(g.id) ?? { sets: 0, volume: 0, stimulus: 0 };
    return {
      muscle: g.id,
      actual_sets: a.sets,
      volume_kg: Math.round(a.volume),
      target_sets: g.weekly_target_sets,
      stimulus: Math.round((a.stimulus / maxStim) * 1000) / 1000,
      vs_target: g.weekly_target_sets
        ? Math.round((a.sets / g.weekly_target_sets) * 100) / 100
        : null,
    };
  });
}

function loadKgOf(s: WindowSetRow): number {
  return computeLoadKg({
    loadMode: s.load_mode as LoadMode,
    entryValue: s.entry_value,
    entryUnit: s.entry_unit as WeightUnit,
    loadBasis: s.load_basis as never,
    isBodyweight: s.is_bodyweight === 1,
    bwFactor: s.bw_factor,
    bodyweightKg: s.bodyweight_kg,
  });
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

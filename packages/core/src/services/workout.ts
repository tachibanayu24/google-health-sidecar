import { insertStmt, runBatch, type Stmt } from '../db/batch-helpers';
import { ulid } from '../db/ids';
import {
  getExerciseMusclesForExercises,
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
import { type LoadMode, MUSCLE_REGION_JA, type SetType, type WeightUnit } from '../domain/enums';
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
import { WRITE_DATATYPE } from '../providers/google-health/discovery-pin';
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
  /** 冪等キー(client 生成 UUID)。オフライン再送/MCP リトライの二重登録を防止(§9.8)。 */
  clientRequestId?: string;
  exercises: Array<{
    exerciseId: string;
    note?: string;
    sets: SaveSetInput[];
  }>;
}

/**
 * ワークアウト保存(§8.5: セッション+種目+セット+gh_sync pending を単一 batch で原子的に)。
 * 派生(PR)は保存後に再計算。GH push はサマリを best-effort(D1正本に影響させない)。
 */
export async function saveWorkout(
  ctx: AppContext,
  input: SaveWorkoutInput,
): Promise<{ sessionId: string; totalVolumeKg: number; newPrs: string[]; ghPushed: boolean }> {
  const now = nowSec();
  // 冪等: 同じ client_request_id のセッションが既にあれば再登録しない(オフライン再送/MCPリトライ, §9.8)。
  if (input.clientRequestId) {
    const ex = await ctx.db.raw<{ id: string }>(
      'SELECT id FROM workout_sessions WHERE client_request_id = ? LIMIT 1',
      input.clientRequestId,
    );
    if (ex[0]) return { sessionId: ex[0].id, totalVolumeKg: 0, newPrs: [], ghPushed: false };
  }
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

  // セッション名は内容(主働筋の部位)から自動命名(手入力廃止。例「胸・腕」)。明示指定があれば尊重。
  const muscleLinks = await getExerciseMusclesForExercises(ctx.db, [...metaCache.keys()]);
  const title =
    input.title ??
    deriveSessionTitle(
      input.exercises.map((e) => e.exerciseId),
      muscleLinks,
    );

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
        superset_group: null, // legacy 列(スーパーセットUIは廃止)。互換のため列は保持し常に null。
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

  const status = input.status ?? 'completed';
  const totalSetCount = input.exercises.reduce((a, e) => a + e.sets.length, 0);
  // 終了時刻: 未指定かつ completed なら セット数から所要を概算して導出(1セット≈3分・最低5分)。
  // MCP 経由は started/ended を省くため両者が now になり GH exercise(start<end 必須)が 400 になる問題の修正。
  const endedAt =
    input.endedAtSec ??
    (status === 'completed' ? startedAt + Math.max(300, totalSetCount * 180) : null);
  const activeDurationSec = endedAt != null ? endedAt - startedAt : null;
  const estCalories = estStrengthCaloriesKcal(bodyweightKg, activeDurationSec);

  // セッション本体(子より先頭でなくとも単一 batch 内なら参照整合は確保される)。
  stmts.unshift(
    insertStmt('workout_sessions', {
      id: sessionId,
      date,
      started_at: startedAt,
      ended_at: endedAt,
      title: title ?? null,
      template_id: null,
      note: null,
      client_request_id: input.clientRequestId ?? null,
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

  // GH push(best-effort, completed のみ)。成否を ghPushed で返す(food/weight と整合・可視化)。
  let ghPushed = false;
  if (status === 'completed' && ctx.pushInline !== false) {
    ghPushed = await pushWorkoutSummary(ctx, {
      sessionId,
      startedAt,
      endedAt: endedAt ?? now,
      activeDurationSec: activeDurationSec ?? Math.max(60, now - startedAt),
      estCalories,
      title: input.title ?? 'Workout',
      summary: buildSummaryNote(input, metaCache),
    });
  }

  return { sessionId, totalVolumeKg: Math.round(totalVolumeKg * 100) / 100, newPrs, ghPushed };
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
): Promise<boolean> {
  try {
    const provider = getProvider(ctx);
    const res = await provider.pushExercise({
      startSec: s.startedAt,
      endSec: Math.max(s.endedAt, s.startedAt + 60), // GH は start<end 必須(防御)
      exerciseType: 'STRENGTH_TRAINING',
      displayName: s.title,
      activeDurationSec: s.activeDurationSec,
      calories: s.estCalories,
      notes: s.summary,
      clientTag: s.sessionId,
    });
    await markPushSynced(ctx.db, 'workout', s.sessionId, res.datapointId, res.dataOrigin, null);
    return true;
  } catch (e) {
    await markPushFailed(ctx.db, 'workout', s.sessionId, errorMessage(e)); // 失敗は cron で再試行
    return false;
  }
}

/**
 * ワークアウト削除(§8.5)。D1 正本を削除し、GH に push 済みなら exercise datapoint を best-effort batchDelete。
 */
export async function deleteWorkout(
  ctx: AppContext,
  sessionId: string,
): Promise<{ deleted: boolean; ghDeleted: boolean }> {
  const rows = await ctx.db.raw<{ gh_datapoint_id: string | null }>(
    "SELECT gh_datapoint_id FROM gh_sync_state WHERE entity_type='workout' AND entity_id=?",
    sessionId,
  );
  const dpId = rows[0]?.gh_datapoint_id ?? null;
  let ghDeleted = false;
  if (dpId) {
    try {
      await getProvider(ctx).batchDelete(WRITE_DATATYPE.exercise, [dpId]);
      ghDeleted = true;
    } catch {
      /* best-effort: GH 失敗でも D1 正本は削除 */
    }
  }
  // §8.5: 台帳と本体を単一 batch で原子的に削除(workout_exercises/sets は CASCADE)。
  await runBatch(ctx.db, [
    {
      sql: "DELETE FROM gh_sync_state WHERE entity_type='workout' AND entity_id=?",
      binds: [sessionId],
    },
    { sql: 'DELETE FROM workout_sessions WHERE id=?', binds: [sessionId] },
  ]);
  return { deleted: true, ghDeleted };
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

  // 種目→部位(role/contribution)を1クエリで一括ロード(N+1 回避)。
  const exerciseIds = [...new Set(sets.map((s) => s.exercise_id))];
  const linksByExercise = await getExerciseMusclesForExercises(ctx.db, exerciseIds);
  const muscleByExercise = new Map<
    string,
    Array<{ muscle: string; role: string; contribution: number }>
  >();
  for (const [exId, ms] of linksByExercise) {
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

export interface MuscleCalendarCell {
  date: string;
  muscle: string;
  sets: number;
}

/**
 * トレーニング・カレンダー(§8.3 派生): 直近 days 日の「いつ・どの部位を鍛えたか」マトリクス。
 * 各ワーキングセットを種目の **primary mover** 部位にのみ帰属させ (date, muscle) 別にセット数を集計する。
 * 補助筋(secondary/stabilizer)は「何の日か」を曖昧にするため帰属に含めない(ベンチ=胸であって腕ではない)。
 * rest 日判別のため、ウォームアップのみでも実施日を sessionDates に含める。表示の部位グルーピングは UI 側。
 */
export async function getMuscleCalendar(
  ctx: AppContext,
  opts: { days?: number } = {},
): Promise<{ days: number; sessionDates: string[]; cells: MuscleCalendarCell[] }> {
  const days = opts.days ?? 30;
  const since = jstDaysAgo(days - 1); // 当日を含めて days 列分
  const sets = await getWindowSets(ctx.db, since);
  const exerciseIds = [...new Set(sets.map((s) => s.exercise_id))];
  const linksByExercise = await getExerciseMusclesForExercises(ctx.db, exerciseIds);
  const primaryByExercise = new Map<string, string[]>();
  for (const [exId, ms] of linksByExercise) {
    primaryByExercise.set(
      exId,
      ms.filter((m) => m.role === 'primary').map((m) => m.muscle_group_id),
    );
  }
  const acc = new Map<string, number>(); // `${date}|${muscle}` → working set 数
  const sessionDates = new Set<string>();
  for (const s of sets) {
    sessionDates.add(s.session_date);
    if (!countsTowardVolume(s.set_type as SetType)) continue;
    for (const muscle of primaryByExercise.get(s.exercise_id) ?? []) {
      const k = `${s.session_date}|${muscle}`;
      acc.set(k, (acc.get(k) ?? 0) + 1);
    }
  }
  const cells: MuscleCalendarCell[] = [...acc].map(([k, n]) => {
    const sep = k.indexOf('|');
    return { date: k.slice(0, sep), muscle: k.slice(sep + 1), sets: n };
  });
  return { days, sessionDates: [...sessionDates].sort(), cells };
}

export interface TrainingFrequencyRow {
  region: string;
  last_trained_date: string | null;
  days_since: number | null;
  weekly_counts: number[]; // [0]=直近7日, [1]=8-14日前 …(その部位を「触れた」日数)
  total_sets: number; // 窓内の主働セット数。last_trained が近くても少なければ過小と判る
}

/**
 * 部位別トレーニング頻度(§5.5-G): 表示区分(胸/背/肩/腕/脚/体幹)ごとの最終実施日・経過日数・
 * 週次「触れた」日数 + 窓内の主働セット数。get_muscle_calendar を集計するより軽く即答できる。
 * 注意: last_trained は「その区分の筋が主働で記録された日」(例: デッドリフトのハムで脚が点灯)。
 *       「足りているか」は total_sets で判断する(少なければ副次的巻き込みのみ)。
 */
export async function getTrainingFrequency(
  ctx: AppContext,
  opts: { weeks?: number } = {},
): Promise<TrainingFrequencyRow[]> {
  const weeks = opts.weeks ?? 4;
  const cal = await getMuscleCalendar(ctx, { days: weeks * 7 });
  const today = todayJst();
  const labels = [...new Set(Object.values(MUSCLE_REGION_JA))]; // 胸/背/肩/腕/脚/体幹
  const acc = new Map<string, { dates: Set<string>; weeks: Set<string>[]; sets: number }>(
    labels.map((l) => [
      l,
      {
        dates: new Set<string>(),
        weeks: Array.from({ length: weeks }, () => new Set<string>()),
        sets: 0,
      },
    ]),
  );
  for (const cell of cal.cells) {
    const region = MUSCLE_REGION_JA[cell.muscle];
    const r = region ? acc.get(region) : undefined;
    if (!r) continue;
    r.dates.add(cell.date);
    r.sets += cell.sets;
    const w = Math.floor(daysBetween(cell.date, today) / 7);
    if (w >= 0 && w < weeks) r.weeks[w]?.add(cell.date);
  }
  return labels.map((region) => {
    const r = acc.get(region)!;
    const sorted = [...r.dates].sort();
    const last = sorted[sorted.length - 1] ?? null;
    return {
      region,
      last_trained_date: last,
      days_since: last ? daysBetween(last, today) : null,
      weekly_counts: r.weeks.map((s) => s.size),
      total_sets: r.sets,
    };
  });
}

/** 主働筋の部位から会話的なセッション名を生成(例「胸・腕」)。primary のみ採用。最大3区分、超過は「他」。 */
function deriveSessionTitle(
  exerciseIds: string[],
  linksByExercise: Map<string, Array<{ muscle_group_id: string; role: string }>>,
): string | null {
  const tally = new Map<string, number>(); // 部位ラベル → 採用種目数
  for (const exId of exerciseIds) {
    const regions = new Set<string>();
    for (const m of linksByExercise.get(exId) ?? []) {
      if (m.role !== 'primary') continue;
      const label = MUSCLE_REGION_JA[m.muscle_group_id];
      if (label) regions.add(label);
    }
    for (const r of regions) tally.set(r, (tally.get(r) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  const ordered = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  return ordered.length <= 3 ? ordered.join('・') : `${ordered.slice(0, 3).join('・')}他`;
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

import { insertStmt, runBatch, type Stmt } from '../db/batch-helpers';
import { ulid } from '../db/ids';
import { getExerciseMusclesForExercises, resolveExercise } from '../db/repositories/exercises';
import { markPushFailed, markPushSynced, pendingPushStmt } from '../db/repositories/sync';
import { type LoadMode, MUSCLE_REGION_JA, type SetType, type WeightUnit } from '../domain/enums';
import {
  computeE1rmKg,
  computeLoadKg,
  computeSetVolumeKg,
  countsTowardVolume,
  estStrengthCaloriesKcal,
  isProvisional,
  prBasisOf,
} from '../domain/metrics';
import type { Exercise } from '../domain/models';
import { WRITE_DATATYPE } from '../providers/google-health/discovery-pin';
import { nowSec, todayJst } from '../util/date';
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

/** 新自己ベスト(saveWorkout 返り値。Web のPR演出 + MCP 返り値=Claudeの祝福に共用)。 */
export interface NewPr {
  exerciseId: string;
  name: string;
  recordType: 'e1rm';
  value: number;
  prevValue: number | null; // 旧ベスト(初記録なら null)
  unit: string;
  isProvisional: boolean; // RPE レス由来=暫定
}

/**
 * ワークアウト保存(§8.5: セッション+種目+セット+gh_sync pending を単一 batch で原子的に)。
 * 派生(PR)は保存後に再計算。GH push はサマリを best-effort(D1正本に影響させない)。
 */
export async function saveWorkout(
  ctx: AppContext,
  input: SaveWorkoutInput,
): Promise<{
  sessionId: string;
  totalVolumeKg: number;
  newPrs: NewPr[];
  ghPushed: boolean;
  title: string | null;
}> {
  const now = nowSec();
  // 冪等: 同じ client_request_id のセッションが既にあれば再登録しない(オフライン再送/MCPリトライ, §9.8)。
  if (input.clientRequestId) {
    const ex = await ctx.db.raw<{ id: string }>(
      'SELECT id FROM workout_sessions WHERE client_request_id = ? LIMIT 1',
      input.clientRequestId,
    );
    if (ex[0])
      return { sessionId: ex[0].id, totalVolumeKg: 0, newPrs: [], ghPushed: false, title: null };
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
      title: title ?? 'Workout', // 自動命名(胸・腕等)も GH へ。inline/retry/D1 で displayName 一致
      summary: buildSummaryNote(input, metaCache),
    });
  }

  return {
    sessionId,
    totalVolumeKg: Math.round(totalVolumeKg * 100) / 100,
    newPrs,
    ghPushed,
    title,
  };
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
): Promise<NewPr[]> {
  const newPrs: NewPr[] = [];
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
    const rows = await ctx.db.raw<{ name_ja: string | null; name_en: string; prev: number | null }>(
      `SELECT ex.name_ja AS name_ja, ex.name_en AS name_en,
              (SELECT pr.value FROM personal_records pr
                WHERE pr.exercise_id=ex.id AND pr.record_type='e1rm'
                ORDER BY pr.value DESC LIMIT 1) AS prev
         FROM exercises ex WHERE ex.id = ?`,
      exerciseId,
    );
    const row = rows[0];
    const prevBest = row?.prev ?? 0;
    if (best.e1rm > prevBest) {
      const basis = prBasisOf(best.setType, best.rpe);
      const provisional = isProvisional(basis);
      await ctx.db.run(
        `INSERT INTO personal_records (id, exercise_id, record_type, value, unit, is_provisional, pr_basis, achieved_set_id, achieved_at)
         VALUES (?, ?, 'e1rm', ?, 'kg', ?, ?, ?, ?)`,
        ulid(),
        exerciseId,
        best.e1rm,
        provisional ? 1 : 0,
        basis,
        best.setId,
        at,
      );
      newPrs.push({
        exerciseId,
        name: row?.name_ja ?? row?.name_en ?? exerciseId,
        recordType: 'e1rm',
        value: Math.round(best.e1rm * 10) / 10,
        prevValue: row?.prev != null ? Math.round(row.prev * 10) / 10 : null,
        unit: 'kg',
        isProvisional: provisional,
      });
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
  // ⚠ personal_records.achieved_set_id は ON DELETE SET NULL のため、セッション削除後は null 化されて
  //   追えなくなり PR が orphan 化する。セットが生きているうちに、このセッションで達成した PR を先に消す。
  //   (PR 台帳は履歴ログなので、以前のベスト行が残り次回 PR 判定の上限が正しく前のベストへ戻る。)
  await runBatch(ctx.db, [
    {
      sql: `DELETE FROM personal_records WHERE achieved_set_id IN (
              SELECT ws.id FROM workout_sets ws
                JOIN workout_exercises we ON we.id = ws.workout_exercise_id
               WHERE we.session_id = ?)`,
      binds: [sessionId],
    },
    {
      sql: "DELETE FROM gh_sync_state WHERE entity_type='workout' AND entity_id=?",
      binds: [sessionId],
    },
    { sql: 'DELETE FROM workout_sessions WHERE id=?', binds: [sessionId] },
  ]);
  return { deleted: true, ghDeleted };
}

/**
 * ワークアウトのメモを設定(単一メモ欄 + 著者ラベル, last-writer-wins)。GH には送らない D1 ローカル注釈。
 * author='user'(UI) / 'ai'(MCP)。最大200文字に丸め、空なら note/author とも null(クリア)。
 */
export async function setWorkoutNote(
  ctx: AppContext,
  input: { sessionId: string; note: string; author: 'user' | 'ai' },
): Promise<{ note: string | null; noteAuthor: 'user' | 'ai' | null }> {
  const trimmed = input.note.trim().slice(0, 200);
  const note = trimmed.length > 0 ? trimmed : null;
  const author = note ? input.author : null;
  await ctx.db.run(
    'UPDATE workout_sessions SET note=?, note_author=?, updated_at=? WHERE id=?',
    note,
    author,
    nowSec(),
    input.sessionId,
  );
  return { note, noteAuthor: author };
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

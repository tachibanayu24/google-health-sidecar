import { getExerciseMusclesForExercises, listMuscleGroups } from '../db/repositories/exercises';
import { getSettings } from '../db/repositories/settings';
import {
  getExerciseHistoryRows,
  getWindowSets,
  type SessionDetailRow,
  type WindowSetRow,
} from '../db/repositories/workouts';
import { type LoadMode, MUSCLE_REGION_JA, type SetType, type WeightUnit } from '../domain/enums';
import {
  computeE1rmKg,
  computeLoadKg,
  computeSetVolumeKg,
  countsTowardVolume,
  recencyDecay,
  setTypeStimulusWeight,
} from '../domain/metrics';
import type { ExerciseHistorySet, MuscleVolume } from '../domain/models';
import { classifyE1rmTrend, type E1rmTrend } from '../domain/training-progress';
import {
  acuteChronicRatio,
  classifyLoadTrend,
  type LoadTrend,
  volumeLandmarkZone,
} from '../domain/volume-landmarks';
import { jstDaysAgo, todayJst } from '../util/date';
import { toKg } from '../util/units';
import type { AppContext } from './context';

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
  const since = jstDaysAgo(windowDays - 1); // 当日含め windowDays 日(getMuscleCalendar と規約統一)
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

  const acc = new Map<
    string,
    { sets: number; effective: number; volume: number; stimulus: number }
  >();
  for (const s of sets) {
    const loadKg = loadKgOf(s);
    const counts = countsTowardVolume(s.set_type as SetType);
    const vol = counts ? computeSetVolumeKg(loadKg, s.reps) : 0;
    const daysAgo = daysBetween(s.session_date, today);
    const decay = recencyDecay(daysAgo, windowDays);
    const stim = vol * setTypeStimulusWeight(s.set_type as SetType) * decay;
    for (const link of muscleByExercise.get(s.exercise_id) ?? []) {
      const a = acc.get(link.muscle) ?? { sets: 0, effective: 0, volume: 0, stimulus: 0 };
      a.sets += counts ? 1 : 0;
      // effective_sets: 間接関与を contribution で加重(primary 1.0/secondary 0.5/stabilizer 0.25)。
      // landmark_zone / vs_target は直接セット基準の MEV/MAV/MRV と比較するため、素の sets ではなく
      // 加重済みの effective を渡す(volume/stimulus は元から加重済みで一貫させる, §8.9)。
      a.effective += counts ? link.contribution : 0;
      a.volume += vol * link.contribution;
      a.stimulus += stim * link.contribution;
      acc.set(link.muscle, a);
    }
  }
  const maxStim = Math.max(1, ...[...acc.values()].map((v) => v.stimulus));
  return groups.map((g) => {
    const a = acc.get(g.id) ?? { sets: 0, effective: 0, volume: 0, stimulus: 0 };
    const landmarks = {
      mev: g.mev_sets,
      mavLow: g.mav_low_sets,
      mavHigh: g.mav_high_sets,
      mrv: g.mrv_sets,
    };
    const effectiveSets = Math.round(a.effective * 10) / 10;
    return {
      muscle: g.id,
      actual_sets: a.sets,
      effective_sets: effectiveSets,
      volume_kg: Math.round(a.volume),
      target_sets: g.weekly_target_sets,
      stimulus: Math.round((a.stimulus / maxStim) * 1000) / 1000,
      vs_target: g.weekly_target_sets
        ? Math.round((effectiveSets / g.weekly_target_sets) * 100) / 100
        : null,
      // ボリュームランドマーク帯(§8.9)。直接セット基準のバンドと比較するため effective_sets(加重)を渡す。
      landmark_zone: volumeLandmarkZone(effectiveSets, landmarks),
      landmarks: {
        mev: g.mev_sets,
        mav_low: g.mav_low_sets,
        mav_high: g.mav_high_sets,
        mrv: g.mrv_sets,
      },
    };
  });
}

export interface MuscleLoad {
  muscle: string;
  acute7_sets: number; // 直近7日のセット数(間接関与含む)
  chronic_weekly_sets: number; // 直近28日の週平均セット数
  ratio: number | null; // acute7 / chronic_weekly(慢性が薄い部位は null)
  trend: LoadTrend | null;
}

/**
 * 部位別 急性/慢性ボリューム比(§8.9 / get_readiness 同梱)。直近7日 vs 直近28日週平均。
 * **怪我予測(ACWR)としては使わない**(学術的に否定済)。漸進性過負荷の記述指標として
 * 急増/定常/低下 の事実のみ示す。set 数は getMuscleVolume と同じく間接関与も1と数える既存規約。
 */
export async function getMuscleLoadRatios(ctx: AppContext): Promise<MuscleLoad[]> {
  const since28 = jstDaysAgo(27);
  const since7 = jstDaysAgo(6);
  const sets = await getWindowSets(ctx.db, since28);
  const exerciseIds = [...new Set(sets.map((s) => s.exercise_id))];
  const linksByExercise = await getExerciseMusclesForExercises(ctx.db, exerciseIds);

  const acc = new Map<string, { acute: number; chronic: number }>();
  for (const s of sets) {
    if (!countsTowardVolume(s.set_type as SetType)) continue;
    const isAcute = s.session_date >= since7;
    for (const link of linksByExercise.get(s.exercise_id) ?? []) {
      const a = acc.get(link.muscle_group_id) ?? { acute: 0, chronic: 0 };
      a.chronic += 1;
      if (isAcute) a.acute += 1;
      acc.set(link.muscle_group_id, a);
    }
  }
  const out: MuscleLoad[] = [];
  for (const [muscle, a] of acc) {
    const chronicWeekly = Math.round((a.chronic / 4) * 10) / 10;
    const ratio = acuteChronicRatio(a.acute, chronicWeekly);
    out.push({
      muscle,
      acute7_sets: a.acute,
      chronic_weekly_sets: chronicWeekly,
      ratio,
      trend: classifyLoadTrend(ratio),
    });
  }
  // 比が出る(慢性が十分な)部位を優先し、比の大きい順。
  return out.sort((x, y) => (y.ratio ?? -1) - (x.ratio ?? -1));
}

export interface PlateauIndicator {
  exercise_id: string;
  name: string;
  trend: E1rmTrend;
  early_best_e1rm: number;
  late_best_e1rm: number;
  pct_change: number;
  sessions: number;
}

/**
 * 種目別 e1RM の停滞検知(§A-3)。窓内(既定56日)で各種目のセッション最高 e1RM 系列を作り、
 * 前半 vs 後半の最高で 伸び/停滞/低下 を記述分類。3セッション以上の種目のみ。判定はせず材料を返す。
 */
export async function getPlateauIndicators(
  ctx: AppContext,
  opts: { windowDays?: number } = {},
): Promise<PlateauIndicator[]> {
  const windowDays = opts.windowDays ?? 56;
  const since = jstDaysAgo(windowDays - 1);
  const [sets, settings] = await Promise.all([getWindowSets(ctx.db, since), getSettings(ctx.db)]);

  // exercise_id → (session_date → そのセッションの最高 e1RM)
  const byExercise = new Map<string, Map<string, number>>();
  for (const s of sets) {
    if (!countsTowardVolume(s.set_type as SetType)) continue;
    const e1rm = computeE1rmKg(loadKgOf(s), s.reps, settings.e1rm_formula);
    if (e1rm == null) continue;
    let perDate = byExercise.get(s.exercise_id);
    if (!perDate) {
      perDate = new Map();
      byExercise.set(s.exercise_id, perDate);
    }
    if (e1rm > (perDate.get(s.session_date) ?? 0)) perDate.set(s.session_date, e1rm);
  }
  const exerciseIds = [...byExercise.keys()];
  if (exerciseIds.length === 0) return [];
  const nameRows = await ctx.db.raw<{ id: string; name_ja: string }>(
    `SELECT id, name_ja FROM exercises WHERE id IN (${exerciseIds.map(() => '?').join(',')})`,
    ...exerciseIds,
  );
  const nameById = new Map(nameRows.map((r) => [r.id, r.name_ja]));

  const out: PlateauIndicator[] = [];
  for (const [exId, perDate] of byExercise) {
    const series = [...perDate].map(([date, e1rm]) => ({ date, e1rm }));
    const r = classifyE1rmTrend(series);
    if (!r) continue; // 3セッション未満は対象外
    out.push({
      exercise_id: exId,
      name: nameById.get(exId) ?? exId,
      trend: r.trend,
      early_best_e1rm: r.earlyBestE1rm,
      late_best_e1rm: r.lateBestE1rm,
      pct_change: r.pctChange,
      sessions: r.sessions,
    });
  }
  // 停滞/低下を上に(注意が要る順)、次いでセッション数が多い順。
  const rank = { declining: 0, plateau: 1, progressing: 2 } as const;
  return out.sort((a, b) => rank[a.trend] - rank[b.trend] || b.sessions - a.sessions);
}

export interface SessionMuscle {
  muscle: string;
  sets: number; // この部位を primary mover とするワーキングセット数(「効かせた主働部位」ラベル用)
  intensity: number; // 0..1。primary/secondary/stabilizer の contribution 加重をセッション内最大で正規化(人体図シェーディング用)
}

/**
 * 単一セッションの部位内訳。シェアレポートの人体図(intensity でグラデーション)と
 * 主働部位ラベル(sets)に使う。getMuscleVolume と異なり期間減衰・体積は持たず、
 * このセッションのワーキングセットだけを contribution 加重で集計する。
 */
export function aggregateSessionMuscles(
  rows: SessionDetailRow[],
  linksByExercise: Map<
    string,
    Array<{ muscle_group_id: string; role: string; contribution: number }>
  >,
): SessionMuscle[] {
  const acc = new Map<string, { sets: number; intensity: number }>();
  for (const r of rows) {
    if (r.set_index == null) continue; // セット行のみ(LEFT JOIN の種目見出し行を除外)
    if (!countsTowardVolume(r.set_type as SetType)) continue; // ウォームアップ等は除外
    for (const link of linksByExercise.get(r.exercise_id) ?? []) {
      const a = acc.get(link.muscle_group_id) ?? { sets: 0, intensity: 0 };
      if (link.role === 'primary') a.sets += 1;
      a.intensity += link.contribution;
      acc.set(link.muscle_group_id, a);
    }
  }
  const maxIntensity = Math.max(1, ...[...acc.values()].map((v) => v.intensity));
  return [...acc]
    .map(([muscle, a]) => ({
      muscle,
      sets: a.sets,
      intensity: Math.round((a.intensity / maxIntensity) * 1000) / 1000,
    }))
    .filter((m) => m.intensity > 0)
    .sort((a, b) => b.intensity - a.intensity);
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

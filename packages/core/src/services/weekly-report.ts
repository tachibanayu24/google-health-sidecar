import { getExerciseMusclesForExercises, listMuscleGroups } from '../db/repositories/exercises';
import { getReadiness } from '../db/repositories/readiness';
import { getActiveNutritionTarget } from '../db/repositories/settings';
import { getWeeklySummary } from '../db/repositories/weekly';
import {
  getLatestWeeklyReportRow,
  getWeeklyReportRow,
  listWeeklyReportRows,
  upsertWeeklyReportRow,
  type WeeklyReportRowInput,
} from '../db/repositories/weekly-reports';
import type { SetType } from '../domain/enums';
import { countsTowardVolume } from '../domain/metrics';
import type { WeeklyReport, WeekReviewData } from '../domain/models';
import { volumeLandmarkZone } from '../domain/volume-landmarks';
import {
  jstDatePlusDays,
  jstDayOfWeek,
  lastCompletedWeekJst,
  todayJst,
  weekBoundsSec,
} from '../util/date';
import { DomainError } from '../util/errors';
import type { AppContext } from './context';
import { getNutritionScore, getNutritionStatus } from './insights';

/**
 * 週次レポート(トレーナーAI生成・MCP保存)の services(docs/weekly-report-design.md)。
 * - get_week_review_data: 固定 Sun–Sat 週の決定的データパック(採点・講評の素材)。
 * - save_weekly_report: スコア+講評+主観文脈を upsert(サーバが metrics_json を凍結)。
 * 生成はアプリ/cron ではなく Claude(MCP)。スコアは Claude が description のルーブリックで写像する。
 */

const SCHEMA_VERSION = 1;

/**
 * weekStart 指定なら weekEnd=+6日、省略なら直近完了週(先週日〜土)。
 * 固定週=日〜土の不変条件を守るため、明示 weekStart は **JST 日曜のみ受理**(非日曜は窓ズレ+
 * 非日曜 PK での二重保存になるため fail-closed で reject。description 文言に頼らずサーバで強制)。
 */
export function resolveWeek(weekStart?: string): { weekStart: string; weekEnd: string } {
  if (weekStart) {
    if (jstDayOfWeek(weekStart) !== 0) {
      throw new DomainError(
        `weekStart は JST 日曜(固定週=日〜土)で指定してください(got: ${weekStart} = 曜日 ${jstDayOfWeek(weekStart)})`,
      );
    }
    return { weekStart, weekEnd: jstDatePlusDays(weekStart, 6) };
  }
  return lastCompletedWeekJst();
}

function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => jstDatePlusDays(weekStart, i));
}

/** 固定週の部位別 effective_sets(間接 contribution 加重・P0-1 基準)→ landmark_zone 帯分布。減衰なし。 */
async function getWeekZoneDistribution(
  ctx: AppContext,
  weekStart: string,
  weekEnd: string,
): Promise<{ zones: WeekReviewData['training']['landmarkZones'] }> {
  const rows = await ctx.db.raw<{ exercise_id: string; set_type: string }>(
    `SELECT we.exercise_id AS exercise_id, ws.set_type AS set_type
       FROM workout_sets ws
       JOIN workout_exercises we ON we.id = ws.workout_exercise_id
       JOIN workout_sessions s ON s.id = we.session_id
      WHERE s.date BETWEEN ? AND ?`,
    weekStart,
    weekEnd,
  );
  const exerciseIds = [...new Set(rows.map((r) => r.exercise_id))];
  const links = await getExerciseMusclesForExercises(ctx.db, exerciseIds);
  const groups = await listMuscleGroups(ctx.db);
  const eff = new Map<string, number>();
  for (const r of rows) {
    if (!countsTowardVolume(r.set_type as SetType)) continue;
    for (const link of links.get(r.exercise_id) ?? []) {
      eff.set(link.muscle_group_id, (eff.get(link.muscle_group_id) ?? 0) + link.contribution);
    }
  }
  const zones = { under: 0, building: 0, optimal: 0, high: 0, over: 0 };
  for (const g of groups) {
    const e = Math.round((eff.get(g.id) ?? 0) * 10) / 10;
    const zone = volumeLandmarkZone(e, {
      mev: g.mev_sets,
      mavLow: g.mav_low_sets,
      mavHigh: g.mav_high_sets,
      mrv: g.mrv_sets,
    });
    if (zone) zones[zone] += 1;
  }
  return { zones };
}

/** 週内各日の readiness を集計して green/yellow/red/learning/noData の日数を返す(learning/欠損は評価母数外)。 */
async function getWeekReadinessSignals(
  ctx: AppContext,
  days: string[],
): Promise<{ readinessDays: WeekReviewData['recovery']['readinessDays']; evaluatedDays: number }> {
  const counts = { green: 0, yellow: 0, red: 0, learning: 0, noData: 0 };
  let evaluated = 0;
  for (const d of days) {
    const r = await getReadiness(ctx.db, d);
    // overall.status は ready|learning の2値のみ(no-data 専用シグナルは無い)。
    // センシング皆無の日(全 contributor が no-data)は noData として learning と区別する。
    if (r.contributors.every((c) => c.status === 'no-data')) {
      counts.noData += 1;
    } else if (r.overall.status === 'learning') {
      counts.learning += 1;
    } else if (r.overall.signal === 'green') {
      counts.green += 1;
      evaluated += 1;
    } else if (r.overall.signal === 'yellow') {
      counts.yellow += 1;
      evaluated += 1;
    } else if (r.overall.signal === 'red') {
      counts.red += 1;
      evaluated += 1;
    }
  }
  return { readinessDays: counts, evaluatedDays: evaluated };
}

/** 固定 Sun–Sat 週の決定的データパック(採点・講評・画像レンダリングの素材)。 */
export async function getWeekReviewData(
  ctx: AppContext,
  weekStart?: string,
): Promise<WeekReviewData> {
  const { weekStart: ws, weekEnd: we } = resolveWeek(weekStart);
  const { startSec, endSec } = weekBoundsSec(ws, we);
  const today = todayJst();
  const days = weekDays(ws);
  const pastDays = days.filter((d) => d <= today);
  const coverageDays = pastDays.length;
  const isComplete = we < today;
  // 週末が今日/昨日だとミラー遅延で終盤センシングが暫定になりうる(P0-3 と同じ正直化)。
  const sensingProvenance = we >= jstDatePlusDays(today, -1) ? 'gh_provisional' : 'd1_confirmed';

  const summary = await getWeeklySummary(ctx.db, ws, we, startSec, endSec);
  const { zones } = await getWeekZoneDistribution(ctx, ws, we);

  // 栄養: 各日の食事スコア(0..1)を採点できた日だけ平均(記録ゼロ日は母数に含めない)。
  let scoreSum = 0;
  let scoredDays = 0;
  for (const d of pastDays) {
    const ns = await getNutritionScore(ctx, d);
    const o = ns.day?.overall;
    if (o != null) {
      scoreSum += o;
      scoredDays += 1;
    }
  }
  const avgDayScore = scoredDays > 0 ? Math.round((scoreSum / scoredDays) * 100) / 100 : null;
  const target = await getActiveNutritionTarget(ctx.db, we);

  const { readinessDays, evaluatedDays } = await getWeekReadinessSignals(ctx, pastDays);

  // 体重トレンド/TDEE は rolling28d(週固定ではない)=文脈。週内 delta は summary(固定窓)を一次に。
  const status = await getNutritionStatus(ctx);

  return {
    schemaVersion: SCHEMA_VERSION,
    weekStart: ws,
    weekEnd: we,
    isComplete,
    coverageDays,
    sensingProvenance,
    training: {
      sessions: summary.training.sessions,
      volumeKg: summary.training.volumeKg,
      prs: summary.training.prs,
      landmarkZones: zones,
      hasData: summary.training.sessions > 0,
    },
    nutrition: {
      avgDayScore,
      scoredDays,
      daysLogged: summary.nutrition.daysLogged,
      avgKcal: summary.nutrition.avgKcal,
      avgP: summary.nutrition.avgP,
      avgF: summary.nutrition.avgF,
      avgC: summary.nutrition.avgC,
      dominantPhase: target?.phase ?? null,
      hasData: summary.nutrition.daysLogged > 0,
    },
    recovery: {
      avgSleepMin: summary.sleep.avgTotalMin,
      avgEfficiency: summary.sleep.avgEfficiency,
      readinessDays,
      evaluatedDays,
      avgHrv: summary.sensing.avgHrv,
      avgRhr: summary.sensing.avgRestingHr,
      hasData: evaluatedDays > 0 || summary.sleep.nights > 0,
    },
    body: {
      startKg: summary.body.startKg,
      endKg: summary.body.endKg,
      deltaKg: summary.body.deltaKg,
      estimatedTdee: status.estimatedTdeeKcal,
      phase: target?.phase ?? null,
      tdeeAsOf: today,
      hasData: summary.body.startKg != null && summary.body.endKg != null,
    },
  };
}

export interface SaveWeeklyReportInput {
  /** 省略時は直近完了週。進行中(週末が未来)の週は reject。 */
  weekStart?: string;
  scores: {
    overall: number | null;
    training: number | null;
    nutrition: number | null;
    recovery: number | null;
    body: number | null;
  };
  headline: string;
  trainingNote?: string | null;
  nutritionNote?: string | null;
  recoveryNote?: string | null;
  bodyNote?: string | null;
  focusNextWeek?: string | null;
  /** ヒアリングで得た主観文脈(自由文)。スコアの決定的入力にはしない(講評の根拠)。 */
  subjectiveContext?: string | null;
  /** 既存レポートの metrics_json を再凍結する(既定 false=当時の snapshot を維持)。 */
  refreshSnapshot?: boolean;
}

/** スコア+講評+主観文脈を保存(week_start で upsert)。metrics_json はサーバが凍結。 */
export async function saveWeeklyReport(
  ctx: AppContext,
  input: SaveWeeklyReportInput,
): Promise<{
  weekStart: string;
  weekEnd: string;
  created: boolean;
  provisionalSensing: boolean;
  subjectiveContext: string | null;
}> {
  const { weekStart: ws, weekEnd: we } = resolveWeek(input.weekStart);
  if (we >= todayJst()) {
    throw new DomainError(
      `対象週(${ws}〜${we})はまだ完了していません。完了した週(週末が過去)のみ保存できます。`,
    );
  }
  const existing = await getWeeklyReportRow(ctx.db, ws);

  let metricsJson: string;
  let provisionalSensing: boolean;
  if (existing && !input.refreshSnapshot) {
    metricsJson = existing.metrics_json; // 当時の snapshot を維持(誠実さ原則)
    try {
      provisionalSensing =
        (JSON.parse(existing.metrics_json) as WeekReviewData).sensingProvenance ===
        'gh_provisional';
    } catch {
      provisionalSensing = false;
    }
  } else {
    const pack = await getWeekReviewData(ctx, ws);
    metricsJson = JSON.stringify(pack);
    provisionalSensing = pack.sensingProvenance === 'gh_provisional';
  }

  const row: WeeklyReportRowInput = {
    week_start: ws,
    week_end: we,
    overall_score: input.scores.overall,
    training_score: input.scores.training,
    nutrition_score: input.scores.nutrition,
    recovery_score: input.scores.recovery,
    body_score: input.scores.body,
    headline: input.headline,
    training_note: input.trainingNote ?? null,
    nutrition_note: input.nutritionNote ?? null,
    recovery_note: input.recoveryNote ?? null,
    body_note: input.bodyNote ?? null,
    focus_next_week: input.focusNextWeek ?? null,
    subjective_context: input.subjectiveContext ?? null,
    metrics_json: metricsJson,
  };
  await upsertWeeklyReportRow(ctx.db, row);

  return {
    weekStart: ws,
    weekEnd: we,
    created: existing == null,
    provisionalSensing,
    subjectiveContext: input.subjectiveContext ?? null,
  };
}

/** 保存済みレポート1件(週指定なし=最新)。metrics は文字列のまま返す(消費側で parse)。 */
export async function getWeeklyReport(
  ctx: AppContext,
  weekStart?: string,
): Promise<WeeklyReport | null> {
  if (weekStart) return getWeeklyReportRow(ctx.db, weekStart);
  return getLatestWeeklyReportRow(ctx.db);
}

/** 保存済みレポート一覧(週降順)。 */
export async function listWeeklyReports(ctx: AppContext, limit = 12): Promise<WeeklyReport[]> {
  return listWeeklyReportRows(ctx.db, limit);
}

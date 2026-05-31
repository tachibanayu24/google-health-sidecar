import type {
  BodyPushInput,
  ExercisePushInput,
  NutritionPushInput,
  ProviderDataPoint,
} from '../HealthProvider';

/**
 * ドメイン push 入力 ⇄ GH v4 のマッピング。
 * フィールド名は 2026-05-31 の discovery doc(+ context7 クロスチェック)で pin 済(§5.1)。
 * 残る未確定(Application object 形 / Operation 応答 / nutrition nutrients 形)は openItem として
 * トークン取得後の契約テストで最終確定する。確定値は本ファイル冒頭の対応表を正とする。
 *
 * 確定マッピング:
 *  - reconcile = GET(client 側)
 *  - 値は DataPoint 直下でなく typed sub-object 配下(weight / bodyFat / steps / sleep /
 *    dailyRestingHeartRate / dailyHeartRateVariability / dailyOxygenSaturation / dailyVo2Max)
 *  - 重量 = weight.weightGrams(double, kg×1000)、体脂肪 = bodyFat.percentage
 *  - exercise は displayName/activeDuration/notes が top-level、calories は metricsSummary.caloriesKcal
 *  - nutrition は nutritionLog.foodName / mealType(enum) / caloriesKcal
 *  - int64(steps.count, beatsPerMinute)は JSON 文字列で返る → 文字列も数値化して受理
 *  - daily 系の時刻は構造化 Date {year,month,day}、weight/bodyFat は sampleTime.physicalTime、
 *    steps/sleep は interval.startTime(RFC3339)
 */

function rfc3339(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

/** 自前 dataSource 識別子(reconcile own-write 判定の補助, §5.4)。主判定は gh_datapoint_id 一致。 */
export const APP_DATA_ORIGIN = 'ghsidecar';
/** recordingMethod は GH enum(MANUAL は存在しない)。ユーザー/アプリ起点入力は ACTIVELY_RECORDED。 */
const RECORDING_METHOD = 'ACTIVELY_RECORDED';
/** application は Application object(正確な形は要トークン検証 §openItem)。best-effort で識別名を載せる。 */
function dataSource(): Record<string, unknown> {
  return { recordingMethod: RECORDING_METHOD, application: { name: APP_DATA_ORIGIN } };
}

// ============ write payload(リクエスト形はこちらが握る → テスト可能) ============

/** exercise create(筋トレはサマリ投影。詳細は D1 が真実, §5.3)。 */
export function buildExercisePayload(input: ExercisePushInput): Record<string, unknown> {
  const exercise: Record<string, unknown> = {
    interval: { startTime: rfc3339(input.startSec), endTime: rfc3339(input.endSec) },
    exerciseType: input.exerciseType,
    // ★top-level(exerciseMetadata ネストではない)
    displayName: input.displayName,
    activeDuration: `${input.activeDurationSec}s`,
    notes: `${input.notes ?? ''}\n[ghsidecar:${input.clientTag}]`.trim(),
  };
  if (input.calories != null) {
    exercise.metricsSummary = { caloriesKcal: input.calories };
  }
  return { dataSource: dataSource(), exercise };
}

/** nutrition-log create(anonymous food, immutable → 編集は delete+create, §5.2)。
 *  ⚠ nutrients[] の正確な形は要トークン検証(openItem)。foodName/mealType/caloriesKcal は確定。 */
export function buildNutritionPayload(input: NutritionPushInput): Record<string, unknown> {
  const nutrients: Array<{ nutrient: string; quantity: { grams: number } }> = [];
  const add = (n: string, g?: number) => {
    if (g != null) nutrients.push({ nutrient: n, quantity: { grams: g } });
  };
  add('PROTEIN', input.proteinG);
  add('TOTAL_FAT', input.fatG);
  add('CARBOHYDRATES', input.carbsG);
  add('DIETARY_FIBER', input.fiberG);
  add('SUGAR', input.sugarG);
  if (input.sodiumMg != null) {
    nutrients.push({ nutrient: 'SODIUM', quantity: { grams: input.sodiumMg / 1000 } });
  }
  const nutritionLog: Record<string, unknown> = {
    interval: { startTime: rfc3339(input.atSec), endTime: rfc3339(input.atSec) },
    mealType: input.mealType,
    foodName: input.foodDisplayName, // ★foodDisplayName ではなく foodName
    caloriesKcal: input.kcal,
    nutrients,
  };
  return { dataSource: dataSource(), nutritionLog };
}

/** body(weight / body-fat)create。手入力は ACTIVELY_RECORDED。重量は weightGrams。 */
export function buildBodyPayload(input: BodyPushInput): Record<string, unknown> {
  const sample = { sampleTime: { physicalTime: rfc3339(input.sampleTimeSec) } };
  if (input.kind === 'weight') {
    const grams = input.weightKg != null ? Math.round(input.weightKg * 1000) : undefined;
    return { dataSource: dataSource(), weight: { ...sample, weightGrams: grams } };
  }
  return { dataSource: dataSource(), bodyFat: { ...sample, percentage: input.bodyFatPct } };
}

// ============ response parse ============

/** create 応答(Operation 想定)から resource name と dataOrigin を取り出す。
 *  ⚠ Operation の正確な形は要トークン検証 → done/response.name と直下 name の両対応で防御的に。 */
export function parseCreateResponse(res: unknown): { datapointId: string; dataOrigin: string } {
  const r = (res ?? {}) as {
    name?: string;
    response?: { name?: string; dataSource?: { application?: { name?: string } } };
    dataSource?: { application?: { name?: string } };
  };
  const datapointId = r.response?.name ?? r.name ?? '';
  const dataOrigin =
    r.response?.dataSource?.application?.name ?? r.dataSource?.application?.name ?? APP_DATA_ORIGIN;
  return { datapointId, dataOrigin };
}

/** reconcile/list 応答 → ProviderDataPoint[]。ラッパーは {dataPoints[], nextPageToken}(確定)。 */
export function parseReconcileResponse(
  dataType: string,
  res: unknown,
): { points: ProviderDataPoint[]; cursor: string | null } {
  const r = (res ?? {}) as { dataPoints?: unknown[]; nextPageToken?: string };
  const points = (r.dataPoints ?? []).map((raw) => mapDataPoint(dataType, raw));
  return { points, cursor: r.nextPageToken ?? null };
}

// ============ 値・時刻の抽出(dataType 別 typed sub-object) ============

/** number または int64 文字列を数値化(Google discovery は int64 を JSON 文字列で返す)。 */
function asNum(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function field(obj: unknown, key: string): unknown {
  return (obj as Record<string, unknown> | undefined)?.[key];
}

export function mapDataPoint(dataType: string, raw: unknown): ProviderDataPoint {
  const p = (raw ?? {}) as Record<string, unknown>;
  const ds = (p.dataSource ?? {}) as {
    application?: { name?: string } | string;
    recordingMethod?: string;
  };
  const app = ds.application;
  const dataOrigin = typeof app === 'string' ? app : app?.name;
  return {
    id: String(p.name ?? ''),
    timeSec: extractTimeSec(dataType, p),
    value: extractValue(dataType, p),
    extra: dataType === 'sleep' ? extractSleep(p) : undefined,
    dataOrigin,
    recordingMethod: ds.recordingMethod,
  };
}

function extractValue(dataType: string, p: Record<string, unknown>): number | null {
  switch (dataType) {
    case 'weight': {
      const g = asNum(field(p.weight, 'weightGrams'));
      return g == null ? null : g / 1000; // kg へ
    }
    case 'body-fat':
      return asNum(field(p.bodyFat, 'percentage'));
    case 'steps':
      return asNum(field(p.steps, 'count'));
    case 'daily-resting-heart-rate':
      return asNum(field(p.dailyRestingHeartRate, 'beatsPerMinute'));
    case 'daily-heart-rate-variability':
      return asNum(field(p.dailyHeartRateVariability, 'averageHeartRateVariabilityMilliseconds'));
    case 'daily-oxygen-saturation':
      return asNum(field(p.dailyOxygenSaturation, 'percentage'));
    case 'daily-vo2-max':
      return asNum(field(p.dailyVo2Max, 'vo2MaxMlPerKgPerMinute'));
    default:
      return null; // sleep は extra、未知は null
  }
}

/** 構造化 Date {year,month,day} → unixepoch 秒(UTC 0時)。 */
function dateObjToSec(d: unknown): number {
  const y = asNum(field(d, 'year'));
  const m = asNum(field(d, 'month'));
  const day = asNum(field(d, 'day'));
  if (!y || !m || !day) return 0; // 部分日付(0)は未対応 → 0
  return Math.floor(Date.UTC(y, m - 1, day) / 1000);
}
function iso8601ToSec(iso: unknown): number {
  if (typeof iso !== 'string') return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}

function extractTimeSec(dataType: string, p: Record<string, unknown>): number {
  switch (dataType) {
    case 'weight':
      return iso8601ToSec(field(field(p.weight, 'sampleTime'), 'physicalTime'));
    case 'body-fat':
      return iso8601ToSec(field(field(p.bodyFat, 'sampleTime'), 'physicalTime'));
    case 'steps':
      return iso8601ToSec(field(field(p.steps, 'interval'), 'startTime'));
    case 'sleep':
      return iso8601ToSec(field(field(p.sleep, 'interval'), 'startTime'));
    case 'daily-resting-heart-rate':
      return dateObjToSec(field(p.dailyRestingHeartRate, 'date'));
    case 'daily-heart-rate-variability':
      return dateObjToSec(field(p.dailyHeartRateVariability, 'date'));
    case 'daily-oxygen-saturation':
      return dateObjToSec(field(p.dailyOxygenSaturation, 'date'));
    case 'daily-vo2-max':
      return dateObjToSec(field(p.dailyVo2Max, 'date'));
    default:
      return 0;
  }
}

/** Sleep: summary.minutesAsleep / minutesInSleepPeriod + stagesSummary[]{type,minutes}。efficiency は導出。 */
function extractSleep(p: Record<string, unknown>): Record<string, number | null> {
  const sleep = (p.sleep ?? {}) as Record<string, unknown>;
  const summary = (sleep.summary ?? {}) as Record<string, unknown>;
  const minutesAsleep = asNum(summary.minutesAsleep);
  const minutesInBed = asNum(summary.minutesInSleepPeriod);
  const stages = Array.isArray(sleep.stagesSummary) ? (sleep.stagesSummary as unknown[]) : [];
  const stageMin = (type: string): number | null => {
    for (const s of stages) {
      if (field(s, 'type') === type) return asNum(field(s, 'minutes'));
    }
    return null;
  };
  const efficiency =
    minutesAsleep != null && minutesInBed && minutesInBed > 0
      ? Math.round((minutesAsleep / minutesInBed) * 1000) / 10
      : null;
  return {
    total_min: minutesAsleep,
    deep_min: stageMin('DEEP'),
    light_min: stageMin('LIGHT'),
    rem_min: stageMin('REM'),
    awake_min: stageMin('AWAKE'),
    efficiency,
  };
}

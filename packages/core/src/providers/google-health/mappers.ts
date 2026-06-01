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
 *  - nutrition は nutritionLog.foodDisplayName / mealType(enum) / energy{kcal} / totalCarbohydrate・totalFat{grams} /
 *    nutrients[]{nutrient(enum), quantity:{grams}}(TOTAL_FAT/CARBOHYDRATES は enum 非対応→top-level)
 *  - int64(steps.count, beatsPerMinute, sleep stage minutes)は JSON 文字列で返る → 文字列も数値化して受理
 *  - daily 系の時刻は構造化 Date {year,month,day}、weight/bodyFat は sampleTime.physicalTime、
 *    steps/sleep は interval.startTime(RFC3339)。oxygen=averagePercentage / respiratory=breathsPerMinute /
 *    sleep の stagesSummary は summary 配下
 */

function rfc3339(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

/** 自前識別子(own-write 判定の補助。主判定は gh_datapoint_id 一致)。 */
export const APP_DATA_ORIGIN = 'ghsidecar';
/** recordingMethod の GH enum 値(実機 400 で ACTIVELY_RECORDED は無効と判明 → 公式例の ACTIVELY_MEASURED)。 */
const RECORDING_METHOD = 'ACTIVELY_MEASURED';
/** dataSource。application の正確な形は未確定なので一旦付けない(任意・400回避)。own-write は gh_datapoint_id で判定。 */
function dataSource(): Record<string, unknown> {
  return { recordingMethod: RECORDING_METHOD };
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
 *  実機 discovery 確定形: foodDisplayName / mealType(enum) / energy=EnergyQuantity{kcal} /
 *  totalCarbohydrate・totalFat=WeightQuantity{grams} / nutrients[]=NutrientQuantity{nutrient,quantity:{grams}}。
 *  ⚠ NutrientQuantity の nutrient enum に TOTAL_FAT/CARBOHYDRATES は無い → 炭水/脂質は top-level field へ。 */
export function buildNutritionPayload(input: NutritionPushInput): Record<string, unknown> {
  const g = (grams: number) => ({ grams });
  const nutrients: Array<{ nutrient: string; quantity: { grams: number } }> = [];
  const add = (n: string, grams?: number) => {
    if (grams != null) nutrients.push({ nutrient: n, quantity: g(grams) });
  };
  add('PROTEIN', input.proteinG);
  add('DIETARY_FIBER', input.fiberG);
  add('SUGAR', input.sugarG);
  if (input.sodiumMg != null) {
    nutrients.push({ nutrient: 'SODIUM', quantity: g(input.sodiumMg / 1000) }); // mg → g
  }
  const nutritionLog: Record<string, unknown> = {
    // 食事は瞬時イベントだが GH は start<end 必須 → 終端を +60s(実機 400 回避)
    interval: { startTime: rfc3339(input.atSec), endTime: rfc3339(input.atSec + 60) },
    mealType: input.mealType,
    foodDisplayName: input.foodDisplayName,
    energy: { kcal: input.kcal }, // EnergyQuantity
    nutrients,
  };
  if (input.carbsG != null) nutritionLog.totalCarbohydrate = g(input.carbsG); // WeightQuantity
  if (input.fatG != null) nutritionLog.totalFat = g(input.fatG);
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
  // reconcile = ReconciledDataPoint(id=dataPointName, 値は data 配下)。list/create は値が直下。両対応。
  const c = (p.data ?? p) as Record<string, unknown>;
  const ds = (p.dataSource ?? c.dataSource ?? {}) as {
    application?: { name?: string } | string;
    recordingMethod?: string;
  };
  const app = ds.application;
  const dataOrigin = typeof app === 'string' ? app : app?.name;
  return {
    id: String(p.dataPointName ?? p.name ?? ''),
    timeSec: extractTimeSec(dataType, c),
    value: extractValue(dataType, c),
    extra: dataType === 'sleep' ? extractSleep(c) : undefined,
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
      return asNum(field(p.dailyOxygenSaturation, 'averagePercentage')); // ★averagePercentage(実機確認)
    case 'daily-vo2-max':
      return asNum(field(p.dailyVo2Max, 'vo2MaxMlPerKgPerMinute'));
    case 'daily-respiratory-rate':
      return asNum(field(p.dailyRespiratoryRate, 'breathsPerMinute')); // ★breathsPerMinute(実機確認)
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
    case 'daily-respiratory-rate':
      return dateObjToSec(field(p.dailyRespiratoryRate, 'date'));
    default:
      return 0;
  }
}

/** Sleep: summary.minutesAsleep / minutesInSleepPeriod + summary.stagesSummary[]{type,minutes}。efficiency は導出。
 *  実機 discovery 確定: stagesSummary は summary 配下、StageSummary={type(enum),minutes(int64文字列),count}。 */
function extractSleep(p: Record<string, unknown>): Record<string, number | null> {
  const sleep = (p.sleep ?? {}) as Record<string, unknown>;
  const summary = (sleep.summary ?? {}) as Record<string, unknown>;
  const minutesAsleep = asNum(summary.minutesAsleep);
  const minutesInBed = asNum(summary.minutesInSleepPeriod);
  const stages = Array.isArray(summary.stagesSummary) ? (summary.stagesSummary as unknown[]) : [];
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
  // 就寝/起床は interval(start/end)。end_sec が無い古い応答は store 側で start+total で補完。
  const interval = sleep.interval as Record<string, unknown> | undefined;
  return {
    total_min: minutesAsleep,
    deep_min: stageMin('DEEP'),
    light_min: stageMin('LIGHT'),
    rem_min: stageMin('REM'),
    awake_min: stageMin('AWAKE'),
    efficiency,
    start_sec: interval ? iso8601ToSec(interval.startTime) || null : null,
    end_sec: interval ? iso8601ToSec(interval.endTime) || null : null,
  };
}

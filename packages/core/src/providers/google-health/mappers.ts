import type {
  BodyPushInput,
  ExercisePushInput,
  NutritionPushInput,
  ProviderDataPoint,
} from '../HealthProvider';

/**
 * ドメイン push 入力 → GH v4 create payload(§5.2/§5.3)。
 * リクエスト形はこちらが握るのでユニットテスト可能。response 形は要検証(discovery pin)。
 */

function rfc3339(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

/** 自前 dataSource 識別子(reconcile own-write 判定の根拠, §5.4)。 */
export const APP_DATA_ORIGIN = 'ghsidecar';

/** exercise create payload(筋トレはサマリ投影。詳細は D1 が真実, §5.3)。 */
export function buildExercisePayload(input: ExercisePushInput): Record<string, unknown> {
  return {
    dataSource: { recordingMethod: 'MANUAL', application: APP_DATA_ORIGIN },
    interval: { startTime: rfc3339(input.startSec), endTime: rfc3339(input.endSec) },
    exerciseType: input.exerciseType,
    exerciseMetadata: {
      displayName: input.displayName,
      activeDuration: `${input.activeDurationSec}s`,
      // notes にサマリ + 逆引きタグ(D1 session 相互参照)。
      notes: `${input.notes ?? ''}\n[ghsidecar:${input.clientTag}]`.trim(),
    },
    ...(input.calories != null ? { metricsSummary: { calories: { kcal: input.calories } } } : {}),
  };
}

/** nutrition-log create payload(anonymous food 固定, immutable → 編集は delete+create, §5.2)。 */
export function buildNutritionPayload(input: NutritionPushInput): Record<string, unknown> {
  const nutrients: Array<{ nutrient: string; quantity: { grams: number } }> = [];
  const push = (n: string, g?: number) => {
    if (g != null) nutrients.push({ nutrient: n, quantity: { grams: g } });
  };
  push('PROTEIN', input.proteinG);
  push('TOTAL_FAT', input.fatG);
  push('CARBOHYDRATES', input.carbsG);
  push('DIETARY_FIBER', input.fiberG);
  push('SUGAR', input.sugarG);
  if (input.sodiumMg != null) {
    nutrients.push({ nutrient: 'SODIUM', quantity: { grams: input.sodiumMg / 1000 } });
  }
  return {
    dataSource: { recordingMethod: 'MANUAL', application: APP_DATA_ORIGIN },
    interval: { startTime: rfc3339(input.atSec), endTime: rfc3339(input.atSec) },
    mealType: input.mealType,
    foodDisplayName: input.foodDisplayName,
    energy: { kcal: input.kcal },
    nutrients,
  };
}

/** body(weight / body-fat)create payload(手入力, recordingMethod=MANUAL, §2.1)。 */
export function buildBodyPayload(input: BodyPushInput): Record<string, unknown> {
  const base = {
    dataSource: { recordingMethod: input.recordingMethod, application: APP_DATA_ORIGIN },
  };
  const sample = { sampleTime: { physicalTime: rfc3339(input.sampleTimeSec) } };
  if (input.kind === 'weight') {
    return { ...base, weight: { ...sample, kilograms: input.weightKg } };
  }
  return { ...base, bodyFat: { ...sample, percentage: input.bodyFatPct } };
}

/** create レスポンスから resource name と dataOrigin を取り出す。 */
export function parseCreateResponse(res: unknown): { datapointId: string; dataOrigin: string } {
  const r = (res ?? {}) as { name?: string; dataSource?: { application?: string } };
  return {
    datapointId: r.name ?? '',
    dataOrigin: r.dataSource?.application ?? APP_DATA_ORIGIN,
  };
}

/**
 * reconcile レスポンス → ProviderDataPoint[]。
 * ⚠ 要検証(§5.1 discovery pin): GH の実 response 形は M0 で確定し、ここを更新+契約テスト。
 * 下記は §5.1 create 例(typed value object)に基づく best-effort パーサ。
 */
export function parseReconcileResponse(
  dataType: string,
  res: unknown,
): { points: ProviderDataPoint[]; cursor: string | null } {
  const r = (res ?? {}) as { dataPoints?: unknown[]; nextPageToken?: string };
  const points = (r.dataPoints ?? []).map((raw) => mapDataPoint(dataType, raw));
  return { points, cursor: r.nextPageToken ?? null };
}

/** 単一 dataPoint → ProviderDataPoint(dataType 別に value を抽出)。要検証。 */
export function mapDataPoint(dataType: string, raw: unknown): ProviderDataPoint {
  const p = (raw ?? {}) as Record<string, unknown>;
  const ds = (p.dataSource ?? {}) as { application?: string; recordingMethod?: string };
  const timeSec = extractTimeSec(p);
  return {
    id: String(p.name ?? ''),
    timeSec,
    value: extractValue(dataType, p),
    extra: dataType === 'sleep' ? extractSleep(p) : undefined,
    dataOrigin: ds.application,
    recordingMethod: ds.recordingMethod,
  };
}

function extractTimeSec(p: Record<string, unknown>): number {
  const interval = p.interval as { startTime?: string } | undefined;
  const sample = p.sampleTime as { physicalTime?: string } | undefined;
  const iso = interval?.startTime ?? sample?.physicalTime;
  return iso ? Math.floor(new Date(iso).getTime() / 1000) : 0;
}

function extractValue(dataType: string, p: Record<string, unknown>): number | null {
  // dataType 別の typed value(要検証: 実フィールド名は discovery doc で確定)。
  const num = (o: unknown, ...keys: string[]): number | null => {
    let cur: unknown = o;
    for (const k of keys) cur = (cur as Record<string, unknown> | undefined)?.[k];
    return typeof cur === 'number' ? cur : null;
  };
  switch (dataType) {
    case 'weight':
      return num(p.weight, 'kilograms');
    case 'body-fat':
      return num(p.bodyFat, 'percentage');
    case 'steps':
      return num(p, 'count') ?? num(p.steps, 'count');
    default:
      // daily 系は value/aggregate を best-effort で
      return num(p, 'value') ?? num(p.dailyValue, 'value');
  }
}

function extractSleep(p: Record<string, unknown>): Record<string, number | null> {
  const s = (p.sleep ?? {}) as Record<string, unknown>;
  const min = (k: string): number | null => (typeof s[k] === 'number' ? (s[k] as number) : null);
  return {
    total_min: min('totalDurationMinutes'),
    deep_min: min('deepDurationMinutes'),
    light_min: min('lightDurationMinutes'),
    rem_min: min('remDurationMinutes'),
    awake_min: min('awakeDurationMinutes'),
  };
}

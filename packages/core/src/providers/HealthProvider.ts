import type { GhMealType } from '../domain/enums';

/**
 * アプリ(SyncService / push)が必要とする健康データ操作の抽象(§10.1)。
 * GH(既定)/ Fitbit(暫定)を差し替え可能にする単一接合点。
 * 将来 strength フィールド追加に備え、ドメインは push 入力で受けて provider が API 形へ写す。
 */

// ---------- pull(daily batch) ----------
/** reconcile/list が返す生データポイント(provider 非依存の最小形)。 */
export interface ProviderDataPoint {
  /** GH dataPoint resource name(= gh_external_id)。 */
  id: string;
  /** JST ではなく UTC unixepoch 秒(格納時に date 算出)。 */
  timeSec: number;
  /** 数値(weight=kg, body_fat=%, hrv=ms 等。dataType 依存)。 */
  value: number | null;
  /** 睡眠など複合値はここに。 */
  extra?: Record<string, number | null>;
  /** 取込み源識別(reconcile で own-write 判定に使う, §5.4)。 */
  dataOrigin?: string;
  /** recordingMethod(MANUAL なら手入力 = own-write 候補)。 */
  recordingMethod?: string;
}

export interface ReconcileResult {
  points: ProviderDataPoint[];
  /** 続きがあれば pageToken、無ければ null。 */
  cursor: string | null;
}

// ---------- push(D1 → GH) ----------
export interface PushResult {
  /** GH dataPoint resource name。gh_sync_state.gh_datapoint_id に保存。 */
  datapointId: string;
  /** 書込み源識別。reconcile own-write 判定用に gh_sync_state.gh_data_origin に保存。 */
  dataOrigin: string;
}

export interface ExercisePushInput {
  startSec: number;
  endSec: number;
  /** 'STRENGTH_TRAINING' 等(exercises.gh_exercise_type)。 */
  exerciseType: string;
  displayName: string;
  activeDurationSec: number;
  calories?: number | null;
  /** notes にサマリ文字列(例 "Bench 60kg×8×3")+逆引きタグ。 */
  notes?: string;
  /** D1 workout_sessions.id(逆引き相互参照)。 */
  clientTag: string;
}

export interface NutritionPushInput {
  atSec: number;
  mealType: GhMealType;
  foodDisplayName: string;
  kcal: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
  clientTag: string;
}

export interface BodyPushInput {
  kind: 'weight' | 'body-fat';
  sampleTimeSec: number;
  /** kind=weight のとき。 */
  weightKg?: number;
  /** kind=body-fat のとき。 */
  bodyFatPct?: number;
  clientTag: string;
}

export interface HealthProvider {
  /** daily batch: 突合済ストリームを取得(§5.4)。filter は dataType 別に呼び出し側が組む(buildReadFilter)。 */
  reconcileDataPoints(
    ghDataType: string,
    filter: string,
    cursor: string | null,
  ): Promise<ReconcileResult>;

  pushExercise(input: ExercisePushInput): Promise<PushResult>;
  /** flag OFF 時は呼び出し側で抑止(§5.2)。 */
  pushNutrition(input: NutritionPushInput): Promise<PushResult>;
  pushBodyMetric(input: BodyPushInput): Promise<PushResult>;

  /** anonymous food は immutable のため食事編集は delete+create(§5.2)。 */
  batchDelete(ghDataType: string, datapointIds: string[]): Promise<void>;
}

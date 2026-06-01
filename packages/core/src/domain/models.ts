import { z } from 'zod';
import {
  BodySide,
  DailyMetricKind,
  DataSource,
  E1rmFormula,
  Equipment,
  ExerciseCategory,
  Laterality,
  LoadBasis,
  LoadMode,
  MealInputMethod,
  MealType,
  MuscleGroupId,
  MuscleRegion,
  MuscleRole,
  NutritionPhase,
  PrBasis,
  RecordType,
  SetType,
  SyncEntityType,
  SyncStatus,
  WeightUnit,
  WorkoutStatus,
} from './enums';

/**
 * ドメインモデル = D1準拠(snake_case, 列名一致)。プロバイダDTO(GH/Fitbit API形)とは
 * 二層分離する(§10.1)。リポジトリは D1 行 ↔ これらのスキーマで safeParse する。
 */

// 共通: unixepoch 秒 / JST 日付。
const Unix = z.number().int();
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const Ulid = z.string().min(1);

// ---------- 設定 / 目標 ----------
export const Settings = z.object({
  id: z.literal(1),
  unit_preference: WeightUnit,
  e1rm_formula: E1rmFormula,
  locale: z.string(),
  updated_at: Unix,
});
export type Settings = z.infer<typeof Settings>;

export const NutritionTarget = z.object({
  id: Ulid,
  date_from: IsoDate,
  phase: NutritionPhase,
  target_kcal: z.number(),
  target_protein_g: z.number(),
  target_fat_g: z.number(),
  target_carbs_g: z.number(),
  target_salt_g: z.number(), // 食塩相当量の上限目標(§9.4)。DBは NOT NULL DEFAULT 6
  created_at: Unix,
});
export type NutritionTarget = z.infer<typeof NutritionTarget>;

// ---------- マスタ ----------
export const MuscleGroup = z.object({
  id: MuscleGroupId,
  name_ja: z.string(),
  name_en: z.string(),
  region: MuscleRegion,
  body_side: BodySide,
  svg_region_id: z.string(),
  weekly_target_sets: z.number().int().nullable(),
  created_at: Unix,
});
export type MuscleGroup = z.infer<typeof MuscleGroup>;

export const Exercise = z.object({
  id: Ulid,
  name_en: z.string(),
  name_ja: z.string().nullable(),
  category: ExerciseCategory,
  equipment: Equipment.nullable(),
  movement_pattern: z.string().nullable(),
  laterality: Laterality,
  load_basis: LoadBasis,
  is_bodyweight: z.coerce.boolean(),
  bw_factor: z.number(),
  default_rep_range: z.string().nullable(),
  gh_exercise_type: z.string().nullable(),
  images: z.string(), // JSON配列文字列
  instructions: z.string(), // JSON配列文字列
  is_custom: z.coerce.boolean(),
  is_favorite: z.coerce.boolean(),
  created_at: Unix,
});
export type Exercise = z.infer<typeof Exercise>;

export const ExerciseMuscle = z.object({
  exercise_id: Ulid,
  muscle_group_id: MuscleGroupId,
  role: MuscleRole,
  contribution: z.number(),
});
export type ExerciseMuscle = z.infer<typeof ExerciseMuscle>;

// ---------- ワークアウト ----------
export const WorkoutSession = z.object({
  id: Ulid,
  date: IsoDate,
  started_at: Unix,
  ended_at: Unix.nullable(),
  title: z.string().nullable(),
  template_id: Ulid.nullable(),
  note: z.string().nullable(),
  bodyweight_kg: z.number().nullable(),
  total_volume_kg: z.number(),
  active_duration_sec: z.number().int().nullable(),
  est_calories: z.number().int().nullable(),
  status: WorkoutStatus,
  source: z.string(),
  created_at: Unix,
  updated_at: Unix,
});
export type WorkoutSession = z.infer<typeof WorkoutSession>;

export const WorkoutExercise = z.object({
  id: Ulid,
  session_id: Ulid,
  exercise_id: Ulid,
  order_index: z.number().int(),
  superset_group: z.number().int().nullable(),
  note: z.string().nullable(),
});
export type WorkoutExercise = z.infer<typeof WorkoutExercise>;

export const WorkoutSet = z.object({
  id: Ulid,
  workout_exercise_id: Ulid,
  set_index: z.number().int(),
  set_type: SetType,
  load_mode: LoadMode,
  entry_value: z.number().nullable(),
  entry_unit: WeightUnit,
  weight_kg: z.number().nullable(),
  reps: z.number().int().nullable(),
  rpe: z.number().nullable(),
  rest_sec: z.number().int().nullable(),
  is_completed: z.coerce.boolean(),
  performed_at: Unix.nullable(),
  created_at: Unix,
});
export type WorkoutSet = z.infer<typeof WorkoutSet>;

export const PersonalRecord = z.object({
  id: Ulid,
  exercise_id: Ulid,
  record_type: RecordType,
  rep_bucket: z.number().int().nullable(),
  value: z.number(), // 常に kg 正規化値(§8.2)
  unit: z.literal('kg'),
  is_provisional: z.coerce.boolean(),
  pr_basis: PrBasis.nullable(),
  achieved_set_id: Ulid.nullable(),
  achieved_at: Unix,
});
export type PersonalRecord = z.infer<typeof PersonalRecord>;

// ---------- 食事 ----------
export const Meal = z.object({
  id: Ulid,
  date: IsoDate,
  logged_at: Unix,
  meal_type: MealType,
  note: z.string().nullable(),
  photo_r2_key: z.string().nullable(),
  input_method: MealInputMethod,
  // 取込分の区別(§5.2 双方向)。0006 migration で列追加(source NOT NULL DEFAULT 'app')。
  source: DataSource,
  gh_external_id: z.string().nullable(),
  created_at: Unix,
  updated_at: Unix,
});
export type Meal = z.infer<typeof Meal>;

export const MealItem = z.object({
  id: Ulid,
  meal_id: Ulid,
  preset_id: Ulid.nullable(),
  food_name: z.string(),
  quantity: z.number(),
  unit: z.string(),
  calories_kcal: z.number(),
  protein_g: z.number(),
  fat_g: z.number(),
  carbs_g: z.number(),
  fiber_g: z.number().nullable(),
  sugar_g: z.number().nullable(),
  sodium_mg: z.number().nullable(),
  created_at: Unix,
});
export type MealItem = z.infer<typeof MealItem>;

export const MealPreset = z.object({
  id: Ulid,
  name: z.string(),
  items_json: z.string(),
  default_meal_type: MealType,
  use_count: z.number().int(),
  created_at: Unix,
  updated_at: Unix,
});
export type MealPreset = z.infer<typeof MealPreset>;

// ---------- 体組成 / 周径 ----------
export const BodyMetric = z.object({
  id: Ulid,
  date: IsoDate,
  measured_at: Unix,
  entry_value: z.number().nullable(),
  entry_unit: WeightUnit.nullable(),
  weight_kg: z.number().nullable(),
  body_fat_pct: z.number().nullable(),
  source: DataSource,
  gh_external_id: z.string().nullable(),
  created_at: Unix,
  updated_at: Unix,
});
export type BodyMetric = z.infer<typeof BodyMetric>;

export const BodyMeasurement = z.object({
  id: Ulid,
  date: IsoDate,
  site: z.string(),
  value_cm: z.number(),
  note: z.string().nullable(),
  created_at: Unix,
});
export type BodyMeasurement = z.infer<typeof BodyMeasurement>;

// ---------- センシング(GHミラー) ----------
export const SleepLog = z.object({
  id: Ulid,
  date: IsoDate,
  start_at: Unix,
  end_at: Unix,
  total_min: z.number().int(),
  deep_min: z.number().int().nullable(),
  light_min: z.number().int().nullable(),
  rem_min: z.number().int().nullable(),
  awake_min: z.number().int().nullable(),
  efficiency: z.number().nullable(),
  source: DataSource,
  gh_external_id: z.string().nullable(),
  created_at: Unix,
  updated_at: Unix,
});
export type SleepLog = z.infer<typeof SleepLog>;

export const DailyMetric = z.object({
  date: IsoDate,
  metric: DailyMetricKind,
  value: z.number(),
  unit: z.string(),
  source: DataSource,
  gh_external_id: z.string().nullable(),
  updated_at: Unix,
});
export type DailyMetric = z.infer<typeof DailyMetric>;

// ---------- 同期台帳 ----------
export const GhSyncState = z.object({
  entity_type: SyncEntityType,
  entity_id: Ulid,
  gh_datapoint_id: z.string().nullable(),
  gh_data_origin: z.string().nullable(),
  sync_status: SyncStatus,
  last_pushed_hash: z.string().nullable(),
  last_pushed_at: Unix.nullable(),
  retry_count: z.number().int(),
  last_error: z.string().nullable(),
  next_retry_at: Unix.nullable(),
  updated_at: Unix,
});
export type GhSyncState = z.infer<typeof GhSyncState>;

export const SyncRun = z.object({
  data_type: z.string(), // GH dataType ID 粒度(§5.4 マスタ表)
  last_synced_at: Unix.nullable(),
  last_cursor: z.string().nullable(),
  last_status: z.enum(['idle', 'running', 'ok', 'error']),
  last_error: z.string().nullable(),
  consecutive_failures: z.number().int(),
  updated_at: Unix,
});
export type SyncRun = z.infer<typeof SyncRun>;

// ---------- 値オブジェクト(計算結果) ----------
/** 1セット分の計算済み実効荷重(§8.1)。MCP/UI へ raw とともに返す。 */
export const SetComputed = z.object({
  load_kg: z.number(), // 実効荷重(kg固定)
  set_volume_kg: z.number(), // load_kg × reps(kg固定)
  e1rm_kg: z.number().nullable(), // reps<=12 のときのみ(kg固定)
});
export type SetComputed = z.infer<typeof SetComputed>;

/** 種目軸の履歴1行(get_exercise_history, §10.4)。 */
export const ExerciseHistorySet = WorkoutSet.merge(SetComputed).extend({
  session_id: Ulid,
  session_date: IsoDate,
});
export type ExerciseHistorySet = z.infer<typeof ExerciseHistorySet>;

/** 部位別ボリューム/刺激(get_muscle_volume, §8.3)。 */
export const MuscleVolume = z.object({
  muscle: MuscleGroupId,
  actual_sets: z.number(),
  volume_kg: z.number(),
  target_sets: z.number().int().nullable(),
  stimulus: z.number(), // ヒートマップ強度 0..1
  vs_target: z.number().nullable(), // actual/target
});
export type MuscleVolume = z.infer<typeof MuscleVolume>;

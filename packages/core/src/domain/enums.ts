import { z } from 'zod';

/**
 * ドメイン語彙の単一の真実(設計書 §5/§7/§8)。
 * D1スキーマ・サービス・MCP契約はすべてここを参照する。
 */

// ---------- 単位(要件8: kg/lb 両対応) ----------
export const WeightUnit = z.enum(['kg', 'lb']);
export type WeightUnit = z.infer<typeof WeightUnit>;

// ---------- 食事 ----------
// アプリ内6種(保持)。GH push 時に GhMealType の4値(UNSPECIFIED除く)へ縮退(§5.2)。
export const MealType = z.enum([
  'Breakfast',
  'MorningSnack',
  'Lunch',
  'AfternoonSnack',
  'Dinner',
  'Anytime',
]);
export type MealType = z.infer<typeof MealType>;

// GH v4 nutrition-log の MealType enum(UNSPECIFIED は未使用)。
export const GhMealType = z.enum(['UNSPECIFIED', 'BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']);
export type GhMealType = z.infer<typeof GhMealType>;

export const MealInputMethod = z.enum(['manual', 'photo', 'preset']);
export type MealInputMethod = z.infer<typeof MealInputMethod>;

// ---------- ワークアウト ----------
export const SetType = z.enum(['warmup', 'main', 'drop', 'backoff', 'amrap', 'failure']);
export type SetType = z.infer<typeof SetType>;

// セット単位の荷重形態(§8.1)。符号規約でなく明示。
export const LoadMode = z.enum(['weighted', 'bodyweight', 'assisted']);
export type LoadMode = z.infer<typeof LoadMode>;

// 入力生値が表す荷重の意味。ボリュームのみ乗数で正規化(§8.1)。
export const LoadBasis = z.enum(['total', 'per_limb', 'per_side']);
export type LoadBasis = z.infer<typeof LoadBasis>;

export const WorkoutStatus = z.enum(['in_progress', 'completed', 'stale']);
export type WorkoutStatus = z.infer<typeof WorkoutStatus>;

// PR台帳(§8.2)。value は常に kg 正規化値。
export const RecordType = z.enum([
  'e1rm',
  'weight_at_reps',
  'max_reps_at_weight',
  'max_volume_session',
]);
export type RecordType = z.infer<typeof RecordType>;

// PR確定根拠(§8.2)。is_provisional と同時確定・永続化。
export const PrBasis = z.enum(['rpe_backed', 'amrap', 'failure', 'rpe_less']);
export type PrBasis = z.infer<typeof PrBasis>;

export const E1rmFormula = z.enum(['epley', 'brzycki']);
export type E1rmFormula = z.infer<typeof E1rmFormula>;

// ---------- 種目マスタ / 部位 ----------
export const ExerciseCategory = z.enum(['compound', 'isolation', 'cardio']);
export type ExerciseCategory = z.infer<typeof ExerciseCategory>;

export const Equipment = z.enum([
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'smith',
  'band',
  'kettlebell',
  'other',
]);
export type Equipment = z.infer<typeof Equipment>;

export const Laterality = z.enum(['bilateral', 'unilateral']);
export type Laterality = z.infer<typeof Laterality>;

export const MuscleRole = z.enum(['primary', 'secondary', 'stabilizer']);
export type MuscleRole = z.infer<typeof MuscleRole>;

// ヒートマップ単位の筋部位(§7 muscle_groups。シード固定)。
export const MuscleGroupId = z.enum([
  'chest',
  'lats',
  'traps',
  'front_delts',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'lower_back',
]);
export type MuscleGroupId = z.infer<typeof MuscleGroupId>;

export const MuscleRegion = z.enum(['upper_push', 'upper_pull', 'legs', 'core']);
export type MuscleRegion = z.infer<typeof MuscleRegion>;

/**
 * 部位の表示グルーピング(16筋群 → 6表示区分の日本語ラベル)。トレーニング分割の粒度。
 * セッション自動命名(主働筋 → 「胸・腕」等)に使う。
 * ※ apps/web の部位カレンダー(Training.tsx REGION_GROUPS)も同じグルーピングを色付きで持つ。
 *    解剖学的グルーピングなので両者は一致させること(変更時は両方更新)。
 */
export const MUSCLE_REGION_JA: Record<string, string> = {
  chest: '胸',
  lats: '背',
  traps: '背',
  front_delts: '肩',
  side_delts: '肩',
  rear_delts: '肩',
  biceps: '腕',
  triceps: '腕',
  forearms: '腕',
  quads: '脚',
  hamstrings: '脚',
  glutes: '脚',
  calves: '脚',
  abs: '体幹',
  obliques: '体幹',
  lower_back: '体幹',
};

export const BodySide = z.enum(['front', 'back']);
export type BodySide = z.infer<typeof BodySide>;

// ---------- 体組成 / センシング ----------
export const NutritionPhase = z.enum(['bulk', 'cut', 'maintain']);
export type NutritionPhase = z.infer<typeof NutritionPhase>;

// body_metrics.source / sleep_logs.source(authoring 由来の区別)。
export const DataSource = z.enum(['google_health', 'app']);
export type DataSource = z.infer<typeof DataSource>;

// daily_metrics.metric(§5.4 マスタ表と一致)。
export const DailyMetricKind = z.enum([
  'resting_hr',
  'hrv_rmssd',
  'spo2_avg',
  'vo2max',
  'resp_rate',
  'skin_temp_c',
  'steps',
  'active_energy_kcal',
]);
export type DailyMetricKind = z.infer<typeof DailyMetricKind>;

// ---------- GH同期 ----------
// body_metric=体重 datapoint、body_metric_fat=体脂肪 datapoint(同一 body_metrics 行を別 datapoint で追跡)。
export const SyncEntityType = z.enum(['workout', 'meal', 'body_metric', 'body_metric_fat']);
export type SyncEntityType = z.infer<typeof SyncEntityType>;

export const SyncStatus = z.enum([
  'pending',
  'synced',
  'failed',
  'dead_letter', // 恒久失敗(403/上限到達)。自動再試行の対象から外れる。
  'stale',
  'deleted_remote',
  'skipped_flag_off',
]);
export type SyncStatus = z.infer<typeof SyncStatus>;

// ---------- 写像テーブル ----------
/** アプリ内6種 → GH実使用4値(§5.2)。 */
export const MEAL_TYPE_TO_GH: Record<MealType, Exclude<GhMealType, 'UNSPECIFIED'>> = {
  Breakfast: 'BREAKFAST',
  Lunch: 'LUNCH',
  Dinner: 'DINNER',
  MorningSnack: 'SNACK',
  AfternoonSnack: 'SNACK',
  Anytime: 'SNACK',
};

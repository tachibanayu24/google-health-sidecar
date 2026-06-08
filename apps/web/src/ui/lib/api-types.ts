/** /api レスポンスの型(core のドメインに概ね対応)。client(api.ts)から分離。 */

export interface Settings {
  unit_preference: 'kg' | 'lb';
  e1rm_formula: 'epley' | 'brzycki';
  locale: string;
  height_cm: number | null;
  birth_year: number | null;
  sex: 'male' | 'female' | null;
}
export interface NutritionTarget {
  phase: string;
  target_kcal: number;
  target_protein_g: number;
  target_fat_g: number;
  target_carbs_g: number;
  target_salt_g: number;
  target_fiber_g: number;
}
export interface Exercise {
  id: string;
  name_en: string;
  name_ja: string; // 必須(全種目に日本語名)。UI は name_ja を主表示。
  category: string;
  equipment: string | null;
  load_basis: string;
  is_bodyweight: boolean;
  bw_factor: number;
  default_rep_range: string | null;
}
export interface HistorySet {
  set_id: string;
  session_id: string;
  session_date: string;
  set_type: string;
  load_mode: string;
  entry_value: number | null;
  entry_unit: 'kg' | 'lb';
  reps: number | null;
  rpe: number | null;
  load_kg: number;
  set_volume_kg: number;
  e1rm_kg: number | null;
}
export type LandmarkZone = 'under' | 'building' | 'optimal' | 'high' | 'over';
export interface MuscleVolume {
  muscle: string;
  actual_sets: number;
  effective_sets: number; // contribution 加重(間接0.5/補助0.25)。landmark_zone/vs_target の基準。
  volume_kg: number;
  target_sets: number | null;
  stimulus: number;
  vs_target: number | null;
  landmark_zone: LandmarkZone | null;
  landmarks: {
    mev: number | null;
    mav_low: number | null;
    mav_high: number | null;
    mrv: number | null;
  };
}
export interface TodayMeal {
  id: string;
  meal_type: string;
  source?: string;
  items: Array<{
    food_name: string;
    calories_kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
    sodium_mg: number | null;
    fiber_g: number | null;
    sugar_g: number | null;
  }>;
}
export interface SleepSummary {
  total_min: number;
  deep_min: number | null;
  light_min: number | null;
  rem_min: number | null;
  awake_min: number | null;
  efficiency: number | null;
  start_at: number;
  end_at: number;
}
export interface BodyReading {
  weightKg: number | null;
  bodyFatPct: number | null;
  source: string | null;
  prevWeightKg: number | null;
}
export interface BodyLogEntry {
  id: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  source: string | null;
  measured_at: number;
}
export interface Today {
  date: string;
  pfc: { kcal: number; p: number; f: number; c: number; salt_g: number; fiber_g: number };
  meals: TodayMeal[];
  inProgress: { id: string; title: string | null; started_at: number } | null;
  body: BodyReading;
  sleep: SleepSummary | null;
  daily: Array<{ metric: string; value: number; unit: string }>;
}

export interface NewPr {
  exerciseId: string;
  name: string;
  recordType: string;
  value: number;
  prevValue: number | null;
  unit: string;
  isProvisional: boolean;
}
export interface SaveWorkoutResult {
  sessionId: string;
  totalVolumeKg: number;
  newPrs: NewPr[];
  ghPushed: boolean;
  title: string | null;
  idempotentHit: boolean; // 冪等再送で既存を返した場合 true(newPrs:[] は『PRなし』でなく『既処理』)
}
export interface FoodSuggestion {
  food_name: string;
  calories_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number | null;
  fiber_g: number | null;
}
export interface Trends {
  days: number;
  body: Array<{ date: string; weight_kg: number | null; body_fat_pct: number | null }>;
  volumeDaily: Array<{ date: string; volume_kg: number }>;
  pfcDaily: Array<{ date: string; kcal: number; p: number; f: number; c: number }>;
}
export interface WeeklySummary {
  range: { start: string; end: string };
  training: { sessions: number; volumeKg: number; prs: number };
  nutrition: {
    daysLogged: number;
    avgKcal: number;
    avgP: number;
    avgF: number;
    avgC: number;
    avgSodiumMg: number;
    avgFiberG: number;
  };
  sleep: { nights: number; avgTotalMin: number | null; avgEfficiency: number | null };
  sensing: {
    avgSteps: number | null;
    avgActiveKcal: number | null;
    avgRestingHr: number | null;
    avgHrv: number | null;
  };
  body: { startKg: number | null; endKg: number | null; deltaKg: number | null };
  target: NutritionTarget | null;
}

export type ReadinessSignal = 'green' | 'yellow' | 'red';
export interface ReadinessContributor {
  metric: string;
  label: string;
  unit: string;
  isCore: boolean;
  status: 'ready' | 'learning' | 'no-data';
  daysOfData: number;
  current: number | null;
  baselineMedian: number | null;
  normalLow: number | null;
  normalHigh: number | null;
  deviation: 'low' | 'normal' | 'high' | null;
  signal: ReadinessSignal | null;
}
export interface Readiness {
  date: string;
  overall: {
    signal: ReadinessSignal | null;
    status: 'ready' | 'learning';
    deviating: number;
    evaluated: number;
    summary: string;
    learningRemainingDays: number;
  };
  contributors: ReadinessContributor[];
  disclaimer: string;
}

export type NutritionAxisKey = 'protein' | 'fat' | 'carbs' | 'fiber' | 'sodium';
export interface NutritionAxis {
  key: NutritionAxisKey;
  labelJa: string;
  value: number | null;
  target: number | null;
  score: number | null; // 0..1。null=データ無し(—)
  zone: 'low' | 'ideal' | 'high' | 'na';
  weight: number;
}
export interface NutritionScopeScore {
  scope: 'day' | 'category';
  phase: string;
  axes: NutritionAxis[];
  overall: number | null;
  calories: {
    kcal: number;
    target: number | null;
    ratio: number | null;
    gate: 'under' | 'ok' | 'over' | 'na';
  };
}
export interface NutritionScore {
  date: string;
  hasTarget: boolean;
  phase: string | null;
  day: NutritionScopeScore | null;
  categories: { mealType: string; labelJa: string; score: NutritionScopeScore }[];
  meals: { mealType: string; foods: string[] }[];
  uncomputable: string[];
  note: string;
}

export interface RoutineSummary {
  id: string;
  name: string;
  goal: string | null;
  is_active: boolean;
  day_count: number;
  updated_at: number;
}
export interface RoutineExerciseDetail {
  id: string;
  position: number;
  exercise_id: string;
  exercise_name: string | null;
  alt_exercise_id: string | null;
  alt_exercise_name: string | null;
  sets_min: number | null;
  sets_max: number | null;
  reps_min: number | null;
  reps_max: number | null;
  target_load: string | null;
  note: string | null;
}
export interface RoutineDay {
  id: string;
  position: number;
  label: string | null;
  title: string;
  aim: string | null;
  main_lift: string | null;
  is_rest: boolean;
  note: string | null;
  exercises: RoutineExerciseDetail[];
  muscles: Array<{ muscle: string; sets: number; intensity: number }>;
}
export interface RoutineDetail {
  id: string;
  name: string;
  goal: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: number;
  updated_at: number;
  days: RoutineDay[];
}

export interface RecentSession {
  id: string;
  date: string;
  title: string | null;
  total_volume_kg: number;
  est_calories: number | null;
  exercises: number;
  sets: number;
}
export interface Pr {
  exercise_id: string;
  name_ja: string | null;
  name_en: string;
  value: number;
  rep_bucket: number | null;
  pr_basis: string | null;
  is_provisional: number;
  achieved_at: number;
}
export interface MealItemInput {
  foodName: string;
  caloriesKcal: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  sodiumMg?: number;
  fiberG?: number;
}
export interface MealPreset {
  id: string;
  name: string;
  defaultMealType: string;
  useCount: number;
  items: MealItemInput[];
}

/** /api クライアント(同一オリジン, 認証は Cookie セッション / dev bypass)。 */

import { enqueue } from './outbox';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** ネット不通(fetch が TypeError) or オフライン。HTTP エラー(res 返却)はこれに含めない。 */
function isOffline(e: unknown): boolean {
  return e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

/**
 * authoring write(食事/ワークアウト)を送信。ネット不通かつ冪等キーがあれば
 * アウトボックスへ退避し queued を立てて返す(オンライン復帰時に再送, §9.8)。
 */
async function submitOrQueue<T>(
  path: string,
  kind: 'meal' | 'workout',
  body: unknown,
  synthetic: (crid: string) => T,
): Promise<T> {
  try {
    return await req<T>(path, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    const crid = (body as { clientRequestId?: string }).clientRequestId;
    if (crid && isOffline(e)) {
      await enqueue({ id: crid, kind, path, body, createdAt: Date.now(), attempts: 0 });
      return synthetic(crid);
    }
    throw e; // HTTP エラーや冪等キー無し(編集など)はそのまま失敗
  }
}

// ---- 型(/api レスポンス。core のドメインに概ね対応) ----
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
  name_ja: string | null;
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

export const api = {
  getSettings: () =>
    req<{ settings: Settings; nutritionTarget: NutritionTarget | null }>('/settings'),
  updateSettings: (body: {
    unitPreference: 'kg' | 'lb';
    e1rmFormula: 'epley' | 'brzycki';
    locale?: string;
    heightCm?: number | null;
    birthYear?: number | null;
    sex?: 'male' | 'female' | null;
  }) => req<{ ok: true }>('/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  setNutritionTarget: (body: {
    phase: 'bulk' | 'cut' | 'maintain';
    kcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
    saltG?: number;
    fiberG?: number;
  }) => req<{ ok: true }>('/nutrition-targets', { method: 'PUT', body: JSON.stringify(body) }),
  searchExercises: (q: string, muscle?: string) =>
    req<{ exercises: Exercise[] }>(
      `/exercises/search?q=${encodeURIComponent(q)}${muscle ? `&muscle=${muscle}` : ''}`,
    ),
  exerciseHistory: (id: string, opts?: { limit?: number }) =>
    req<{ sets: HistorySet[] }>(
      `/exercises/${encodeURIComponent(id)}/history${opts?.limit ? `?limit=${opts.limit}` : ''}`,
    ),
  muscleVolume: (windowDays = 7) =>
    req<{ windowDays: number; muscles: MuscleVolume[] }>(`/muscle-volume?window=${windowDays}`),
  muscleCalendar: (days = 30) =>
    req<{
      days: number;
      sessionDates: string[];
      cells: Array<{ date: string; muscle: string; sets: number }>;
    }>(`/training-calendar?days=${days}`),
  trends: (days = 90) => req<Trends>(`/trends?days=${days}`),
  readiness: (date?: string) => req<Readiness>(`/readiness${date ? `?date=${date}` : ''}`),
  bodyLog: (date: string) => req<{ date: string; logs: BodyLogEntry[] }>(`/body-log?date=${date}`),
  deleteBodyMetric: (id: string) =>
    req<{ deleted: boolean; ghDeleted: boolean }>(`/body-metrics/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  routines: () => req<{ routines: RoutineSummary[] }>('/routines'),
  routine: (id: string) => req<RoutineDetail>(`/routines/${id}`),
  weeklySummary: () => req<WeeklySummary>('/weekly-summary'),
  today: (date?: string) => req<Today>(`/today${date ? `?date=${date}` : ''}`),
  foodAutocomplete: (q: string) =>
    req<{ foods: FoodSuggestion[] }>(`/foods/autocomplete?q=${encodeURIComponent(q)}`),
  saveWorkout: (body: unknown) =>
    submitOrQueue<SaveWorkoutResult & { queued?: boolean }>(
      '/workouts',
      'workout',
      body,
      (crid) => ({
        sessionId: crid,
        totalVolumeKg: 0,
        newPrs: [],
        ghPushed: false,
        title: null,
        queued: true,
      }),
    ),
  logMeal: (body: unknown) =>
    submitOrQueue<{ mealId: string; ghPushed: boolean; queued?: boolean }>(
      '/meals',
      'meal',
      body,
      (crid) => ({ mealId: crid, ghPushed: false, queued: true }),
    ),
  getMeal: (id: string) =>
    req<{
      meal: { id: string; date: string; logged_at: number; meal_type: string; note: string | null };
      items: Array<{
        food_name: string;
        calories_kcal: number;
        protein_g: number;
        fat_g: number;
        carbs_g: number;
        sodium_mg: number | null;
        fiber_g: number | null;
      }>;
    }>(`/meals/${encodeURIComponent(id)}`),
  deleteMeal: (id: string) =>
    req<{ deleted: boolean; ghDeleted: boolean }>(`/meals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  recentWorkouts: () => req<{ sessions: RecentSession[] }>('/workouts/recent'),
  getWorkout: (id: string) =>
    req<{
      session: {
        id: string;
        date: string;
        startedAt: number;
        title: string | null;
        bodyweightKg: number | null;
      };
      exercises: Array<{
        exerciseId: string;
        name_en: string;
        name_ja: string | null;
        sets: Array<{
          setType: string;
          entryValue: number | null;
          entryUnit: string;
          reps: number | null;
          rpe: number | null;
        }>;
      }>;
      muscles: Array<{ muscle: string; sets: number; intensity: number }>;
    }>(`/workouts/${encodeURIComponent(id)}`),
  deleteWorkout: (id: string) =>
    req<{ deleted: boolean; ghDeleted: boolean }>(`/workouts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  prs: () => req<{ prs: Pr[] }>('/prs'),
  syncStatus: () =>
    req<{
      authError: string | null;
      pushQueue: { pending: number; failed: number; deadLetter: number };
      runs: Array<{
        data_type: string;
        last_synced_at: number | null;
        last_status: string | null;
        last_error: string | null;
        consecutive_failures: number;
      }>;
    }>('/sync-status'),
  mealPresets: () => req<{ presets: MealPreset[] }>('/meal-presets'),
  saveMealPreset: (body: { name: string; defaultMealType: string; items: MealItemInput[] }) =>
    req<{ presetId: string }>('/meal-presets', { method: 'POST', body: JSON.stringify(body) }),
  deleteMealPreset: (id: string) =>
    req<{ ok: true }>(`/meal-presets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  logWeight: (body: unknown) =>
    req<{ id: string; ghPushed: boolean }>('/body/weight', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

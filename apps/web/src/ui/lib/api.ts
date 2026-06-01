/** /api クライアント(同一オリジン, 認証は Cookie セッション / dev bypass)。 */

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

// ---- 型(/api レスポンス。core のドメインに概ね対応) ----
export interface Settings {
  unit_preference: 'kg' | 'lb';
  e1rm_formula: 'epley' | 'brzycki';
  locale: string;
}
export interface NutritionTarget {
  phase: string;
  target_kcal: number;
  target_protein_g: number;
  target_fat_g: number;
  target_carbs_g: number;
  target_salt_g: number;
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
export interface MuscleVolume {
  muscle: string;
  actual_sets: number;
  volume_kg: number;
  target_sets: number | null;
  stimulus: number;
  vs_target: number | null;
}
export interface TodayMeal {
  id: string;
  meal_type: string;
  items: Array<{
    food_name: string;
    calories_kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  }>;
}
export interface SleepSummary {
  total_min: number;
  deep_min: number | null;
  light_min: number | null;
  rem_min: number | null;
  awake_min: number | null;
  efficiency: number | null;
}
export interface Today {
  date: string;
  pfc: { kcal: number; p: number; f: number; c: number; salt_g: number };
  meals: TodayMeal[];
  inProgress: { id: string; title: string | null; started_at: number } | null;
  body: Array<{ source: string; weight_kg: number | null; body_fat_pct: number | null }>;
  sleep: SleepSummary | null;
  daily: Array<{ metric: string; value: number; unit: string }>;
}

export interface SaveWorkoutResult {
  sessionId: string;
  totalVolumeKg: number;
  newPrs: string[];
}
export interface FoodSuggestion {
  food_name: string;
  calories_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number | null;
}
export interface Trends {
  days: number;
  body: Array<{ date: string; weight_kg: number | null; body_fat_pct: number | null }>;
  volumeDaily: Array<{ date: string; volume_kg: number }>;
  pfcDaily: Array<{ date: string; kcal: number; p: number; f: number; c: number }>;
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
  achieved_at: number;
}
export interface MealItemInput {
  foodName: string;
  caloriesKcal: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  sodiumMg?: number;
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
  }) => req<{ ok: true }>('/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  setNutritionTarget: (body: {
    phase: 'bulk' | 'cut' | 'maintain';
    kcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
    saltG?: number;
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
  trends: (days = 90) => req<Trends>(`/trends?days=${days}`),
  today: (date?: string) => req<Today>(`/today${date ? `?date=${date}` : ''}`),
  foodAutocomplete: (q: string) =>
    req<{ foods: FoodSuggestion[] }>(`/foods/autocomplete?q=${encodeURIComponent(q)}`),
  saveWorkout: (body: unknown) =>
    req<SaveWorkoutResult>('/workouts', { method: 'POST', body: JSON.stringify(body) }),
  logMeal: (body: unknown) =>
    req<{ mealId: string; ghPushed: boolean }>('/meals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
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
      }>;
    }>(`/meals/${encodeURIComponent(id)}`),
  deleteMeal: (id: string) =>
    req<{ deleted: boolean; ghDeleted: boolean }>(`/meals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  recentWorkouts: () => req<{ sessions: RecentSession[] }>('/workouts/recent'),
  deleteWorkout: (id: string) =>
    req<{ deleted: boolean; ghDeleted: boolean }>(`/workouts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  prs: () => req<{ prs: Pr[] }>('/prs'),
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

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
export interface Today {
  date: string;
  pfc: { kcal: number; p: number; f: number; c: number };
  meals: TodayMeal[];
  inProgress: { id: string; title: string | null; started_at: number } | null;
  body: Array<{ source: string; weight_kg: number | null; body_fat_pct: number | null }>;
}

export interface SaveWorkoutResult {
  sessionId: string;
  totalVolumeKg: number;
  newPrs: string[];
}

export const api = {
  getSettings: () =>
    req<{ settings: Settings; nutritionTarget: NutritionTarget | null }>('/settings'),
  searchExercises: (q: string, muscle?: string) =>
    req<{ exercises: Exercise[] }>(
      `/exercises/search?q=${encodeURIComponent(q)}${muscle ? `&muscle=${muscle}` : ''}`,
    ),
  exerciseHistory: (id: string) =>
    req<{ sets: HistorySet[] }>(`/exercises/${encodeURIComponent(id)}/history`),
  muscleVolume: (windowDays = 7) =>
    req<{ windowDays: number; muscles: MuscleVolume[] }>(`/muscle-volume?window=${windowDays}`),
  today: () => req<Today>('/today'),
  saveWorkout: (body: unknown) =>
    req<SaveWorkoutResult>('/workouts', { method: 'POST', body: JSON.stringify(body) }),
  logMeal: (body: unknown) =>
    req<{ mealId: string; ghPushed: boolean }>('/meals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  logWeight: (body: unknown) =>
    req<{ id: string; ghPushed: boolean }>('/body/weight', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

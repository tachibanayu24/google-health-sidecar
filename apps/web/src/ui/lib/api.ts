/** /api クライアント(同一オリジン, 認証は Cookie セッション / dev bypass)。型は api-types.ts。 */

import type {
  BodyLogEntry,
  Exercise,
  FoodSuggestion,
  HistorySet,
  MealItemInput,
  MealPreset,
  MuscleVolume,
  NutritionScore,
  NutritionTarget,
  Pr,
  Readiness,
  RecentSession,
  RoutineDetail,
  RoutineSummary,
  SaveWorkoutResult,
  Settings,
  Today,
  Trends,
  WeeklySummary,
} from './api-types';
import { enqueue } from './outbox';

// 型は api-types.ts に分離。従来どおり '../lib/api' から型も import できるよう re-export。
export type * from './api-types';

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
  nutritionScore: (date?: string) =>
    req<NutritionScore>(`/nutrition-score${date ? `?date=${date}` : ''}`),
  bodyLog: (date: string) => req<{ date: string; logs: BodyLogEntry[] }>(`/body-log?date=${date}`),
  deleteBodyMetric: (id: string) =>
    req<{ deleted: boolean; ghDeleted: boolean }>(`/body-metrics/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  routines: () => req<{ routines: RoutineSummary[] }>('/routines'),
  routine: (id: string) => req<RoutineDetail>(`/routines/${id}`),
  deleteRoutine: (id: string) =>
    req<{ deleted: boolean }>(`/routines/${encodeURIComponent(id)}`, { method: 'DELETE' }),
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
        note: string | null;
        noteAuthor: 'user' | 'ai' | null;
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
  setWorkoutNote: (id: string, note: string) =>
    req<{ note: string | null; noteAuthor: 'user' | 'ai' | null }>(
      `/workouts/${encodeURIComponent(id)}/note`,
      { method: 'PATCH', body: JSON.stringify({ note }) },
    ),
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

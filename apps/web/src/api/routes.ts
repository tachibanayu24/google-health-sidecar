import {
  autocompleteFoods,
  deleteMeal,
  deleteMealPresetRow,
  deleteWorkout,
  getActiveNutritionTarget,
  getAllSyncRuns,
  getBodyForDate,
  getDailyMetricsByDate,
  getExerciseHistory,
  getGhAuthError,
  getInProgressSession,
  getMealById,
  getMealItems,
  getMealsByDate,
  getMuscleVolume,
  getRecentPrs,
  getRecentSessions,
  getSessionDetail,
  getSettings,
  getSleepByDate,
  getTrends,
  jstDaysAgo,
  type LogMealInput,
  type LogWeightInput,
  listMealPresets,
  logMeal,
  logWeight,
  type MealItemInput,
  makeContext,
  type SaveWorkoutInput,
  type SetNutritionTargetInput,
  saltGFromSodiumMg,
  saveMealPreset,
  saveWorkout,
  searchExercises,
  setNutritionTarget,
  type UpdateSettingsInput,
  updateSettings,
} from '@ghs/core';
import { Hono } from 'hono';
import type { HonoEnv } from '../env';

/** UIバックエンド /api(§10.4 read 契約と対応, 全 write は services 経由 §8.5)。 */
export const api = new Hono<HonoEnv>();

api.get('/me', (c) => {
  const user = c.get('user');
  return c.json({ email: user.email, sub: user.sub });
});

api.get('/settings', async (c) => {
  const ctx = makeContext(c.env);
  const [settings, target] = await Promise.all([
    getSettings(ctx.db),
    getActiveNutritionTarget(ctx.db),
  ]);
  return c.json({ settings, nutritionTarget: target });
});

api.patch('/settings', async (c) => {
  const ctx = makeContext(c.env);
  const body = (await c.req.json()) as UpdateSettingsInput;
  if (
    (body?.unitPreference !== 'kg' && body?.unitPreference !== 'lb') ||
    (body?.e1rmFormula !== 'epley' && body?.e1rmFormula !== 'brzycki')
  ) {
    return c.json({ error: 'unitPreference(kg|lb) and e1rmFormula(epley|brzycki) required' }, 400);
  }
  await updateSettings(ctx, body);
  return c.json({ ok: true });
});

api.put('/nutrition-targets', async (c) => {
  const ctx = makeContext(c.env);
  const body = (await c.req.json()) as SetNutritionTargetInput;
  const nums = [body?.kcal, body?.proteinG, body?.fatG, body?.carbsG];
  if (
    !['bulk', 'cut', 'maintain'].includes(body?.phase) ||
    nums.some((v) => typeof v !== 'number' || v < 0)
  ) {
    return c.json({ error: 'phase(bulk|cut|maintain) and non-negative kcal/PFC required' }, 400);
  }
  await setNutritionTarget(ctx, body);
  return c.json({ ok: true });
});

api.get('/exercises/search', async (c) => {
  const ctx = makeContext(c.env);
  const q = c.req.query('q');
  const muscle = c.req.query('muscle');
  const rows = await searchExercises(ctx.db, { query: q, muscle, limit: 50 });
  return c.json({ exercises: rows });
});

api.get('/foods/autocomplete', async (c) => {
  const ctx = makeContext(c.env);
  const q = c.req.query('q') ?? '';
  if (q.trim().length === 0) return c.json({ foods: [] });
  const items = await autocompleteFoods(ctx.db, q, 8);
  // 同名は最新1件に集約して候補化(food_name + 直近PFC)。
  const seen = new Set<string>();
  const foods: Array<{
    food_name: string;
    calories_kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
    sodium_mg: number | null;
  }> = [];
  for (const it of items) {
    if (seen.has(it.food_name)) continue;
    seen.add(it.food_name);
    foods.push({
      food_name: it.food_name,
      calories_kcal: it.calories_kcal,
      protein_g: it.protein_g,
      fat_g: it.fat_g,
      carbs_g: it.carbs_g,
      sodium_mg: it.sodium_mg,
    });
  }
  return c.json({ foods });
});

api.get('/exercises/:id/history', async (c) => {
  const ctx = makeContext(c.env);
  const since = c.req.query('since');
  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? Math.min(2000, Math.max(1, Number(limitRaw) || 0)) : undefined;
  const sets = await getExerciseHistory(ctx, c.req.param('id'), { since, limit });
  return c.json({ provenance: 'd1_confirmed', sets });
});

api.get('/trends', async (c) => {
  const ctx = makeContext(c.env);
  const days = Math.min(365, Number(c.req.query('days') ?? '90') || 90);
  const trends = await getTrends(ctx.db, jstDaysAgo(days));
  return c.json({ days, provenance: 'd1_confirmed', ...trends });
});

api.get('/muscle-volume', async (c) => {
  const ctx = makeContext(c.env);
  const windowDays = Number(c.req.query('window') ?? '7') || 7;
  const muscles = await getMuscleVolume(ctx, { windowDays });
  return c.json({ windowDays, provenance: 'd1_confirmed', muscles });
});

api.get('/today', async (c) => {
  const ctx = makeContext(c.env);
  const date = c.req.query('date') ?? undefined;
  const d = date ?? new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const [meals, inProgress, body, sleep, daily] = await Promise.all([
    getMealsByDate(ctx.db, d),
    getInProgressSession(ctx.db),
    getBodyForDate(ctx.db, d),
    getSleepByDate(ctx.db, d),
    getDailyMetricsByDate(ctx.db, d),
  ]);
  const mealsWithItems = await Promise.all(
    meals.map(async (m) => ({ ...m, items: await getMealItems(ctx.db, m.id) })),
  );
  const agg = mealsWithItems
    .flatMap((m) => m.items)
    .reduce(
      (a, it) => ({
        kcal: a.kcal + it.calories_kcal,
        p: a.p + it.protein_g,
        f: a.f + it.fat_g,
        c: a.c + it.carbs_g,
        sodiumMg: a.sodiumMg + (it.sodium_mg ?? 0),
      }),
      { kcal: 0, p: 0, f: 0, c: 0, sodiumMg: 0 },
    );
  // 表示は食塩相当量(g)。GHには sodium(mg)で保存。
  const pfc = {
    kcal: agg.kcal,
    p: agg.p,
    f: agg.f,
    c: agg.c,
    salt_g: Math.round(saltGFromSodiumMg(agg.sodiumMg) * 10) / 10,
  };
  return c.json({
    date: d,
    provenance: 'd1_confirmed',
    meals: mealsWithItems,
    pfc,
    inProgress,
    body,
    sleep,
    daily,
  });
});

api.post('/workouts', async (c) => {
  const ctx = makeContext(c.env);
  const body = (await c.req.json()) as SaveWorkoutInput;
  if (!Array.isArray(body?.exercises) || body.exercises.length === 0) {
    return c.json({ error: 'exercises required' }, 400);
  }
  const result = await saveWorkout(ctx, body);
  return c.json(result, 201);
});

api.get('/workouts/recent', async (c) => {
  const ctx = makeContext(c.env);
  const limit = Math.min(60, Number(c.req.query('limit') ?? '30') || 30);
  const sessions = await getRecentSessions(ctx.db, limit);
  return c.json({ sessions });
});

api.get('/workouts/:id', async (c) => {
  const ctx = makeContext(c.env);
  const rows = await getSessionDetail(ctx.db, c.req.param('id'));
  if (rows.length === 0) return c.json({ error: 'not found' }, 404);
  const first = rows[0]!;
  // 平坦行を 種目×セット に再構成。
  const byEx = new Map<
    string,
    {
      exerciseId: string;
      name_en: string;
      name_ja: string | null;
      supersetGroup: number | null;
      order: number;
      sets: Array<{
        setType: string;
        entryValue: number | null;
        entryUnit: string;
        reps: number | null;
        rpe: number | null;
      }>;
    }
  >();
  for (const r of rows) {
    let e = byEx.get(r.exercise_id + ':' + r.order_index);
    if (!e) {
      e = {
        exerciseId: r.exercise_id,
        name_en: r.name_en,
        name_ja: r.name_ja,
        supersetGroup: r.superset_group,
        order: r.order_index,
        sets: [],
      };
      byEx.set(r.exercise_id + ':' + r.order_index, e);
    }
    if (r.set_index != null && r.entry_value != null) {
      e.sets.push({
        setType: r.set_type,
        entryValue: r.entry_value,
        entryUnit: r.entry_unit,
        reps: r.reps,
        rpe: r.rpe,
      });
    } else if (r.set_index != null) {
      e.sets.push({
        setType: r.set_type,
        entryValue: r.entry_value,
        entryUnit: r.entry_unit,
        reps: r.reps,
        rpe: r.rpe,
      });
    }
  }
  return c.json({
    session: {
      id: first.id,
      date: first.date,
      title: first.title,
      bodyweightKg: first.bodyweight_kg,
    },
    exercises: [...byEx.values()].sort((a, b) => a.order - b.order),
  });
});

api.delete('/workouts/:id', async (c) => {
  const ctx = makeContext(c.env);
  const result = await deleteWorkout(ctx, c.req.param('id'));
  return c.json(result);
});

api.get('/prs', async (c) => {
  const ctx = makeContext(c.env);
  const prs = await getRecentPrs(ctx.db, 20);
  return c.json({ prs });
});

api.get('/sync-status', async (c) => {
  const ctx = makeContext(c.env);
  const [runs, authError] = await Promise.all([getAllSyncRuns(ctx.db), getGhAuthError(ctx.tokens)]);
  return c.json({
    authError,
    runs: runs.map((r) => ({
      data_type: r.data_type,
      last_synced_at: r.last_synced_at,
      last_status: r.last_status,
      last_error: r.last_error,
      consecutive_failures: r.consecutive_failures,
    })),
  });
});

api.get('/meal-presets', async (c) => {
  const ctx = makeContext(c.env);
  const rows = await listMealPresets(ctx.db);
  // items_json はパースして返す。
  const presets = rows.map((r) => ({
    id: r.id,
    name: r.name,
    defaultMealType: r.default_meal_type,
    useCount: r.use_count,
    items: JSON.parse(r.items_json) as MealItemInput[],
  }));
  return c.json({ presets });
});

api.post('/meal-presets', async (c) => {
  const ctx = makeContext(c.env);
  const body = (await c.req.json()) as {
    name?: string;
    defaultMealType?: string;
    items?: MealItemInput[];
  };
  if (!body?.name || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'name and items required' }, 400);
  }
  const result = await saveMealPreset(ctx, {
    name: body.name,
    defaultMealType: (body.defaultMealType ?? 'Anytime') as never,
    items: body.items,
  });
  return c.json(result, 201);
});

api.delete('/meal-presets/:id', async (c) => {
  const ctx = makeContext(c.env);
  await deleteMealPresetRow(ctx.db, c.req.param('id'));
  return c.json({ ok: true });
});

api.post('/meals', async (c) => {
  const ctx = makeContext(c.env);
  const body = (await c.req.json()) as LogMealInput;
  if (!body?.mealType || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'mealType and items required' }, 400);
  }
  const result = await logMeal(ctx, body);
  return c.json(result, 201);
});

api.get('/meals/:id', async (c) => {
  const ctx = makeContext(c.env);
  const id = c.req.param('id');
  const meal = await getMealById(ctx.db, id);
  if (!meal) return c.json({ error: 'not found' }, 404);
  const items = await getMealItems(ctx.db, id);
  return c.json({ meal, items });
});

api.delete('/meals/:id', async (c) => {
  const ctx = makeContext(c.env);
  const result = await deleteMeal(ctx, c.req.param('id'));
  return c.json(result);
});

api.post('/body/weight', async (c) => {
  const ctx = makeContext(c.env);
  const body = (await c.req.json()) as LogWeightInput;
  if (typeof body?.entryValue !== 'number' || !body.entryUnit) {
    return c.json({ error: 'entryValue and entryUnit required' }, 400);
  }
  const result = await logWeight(ctx, body);
  return c.json(result, 201);
});

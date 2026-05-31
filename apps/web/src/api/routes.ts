import {
  getActiveNutritionTarget,
  getBodyMetricsByDate,
  getExerciseHistory,
  getInProgressSession,
  getMealItems,
  getMealsByDate,
  getMuscleVolume,
  getSettings,
  type LogMealInput,
  type LogWeightInput,
  logMeal,
  logWeight,
  makeContext,
  type SaveWorkoutInput,
  saveWorkout,
  searchExercises,
} from '@ghs/core';
import { Hono } from 'hono';
import type { HonoEnv } from '../env';

/** UIバックエンド /api(§10.4 read 契約と対応, 全 write は services 経由 §8.5)。 */
export const api = new Hono<HonoEnv>();

api.get('/settings', async (c) => {
  const ctx = makeContext(c.env);
  const [settings, target] = await Promise.all([
    getSettings(ctx.db),
    getActiveNutritionTarget(ctx.db),
  ]);
  return c.json({ settings, nutritionTarget: target });
});

api.get('/exercises/search', async (c) => {
  const ctx = makeContext(c.env);
  const q = c.req.query('q');
  const muscle = c.req.query('muscle');
  const rows = await searchExercises(ctx.db, { query: q, muscle, limit: 50 });
  return c.json({ exercises: rows });
});

api.get('/exercises/:id/history', async (c) => {
  const ctx = makeContext(c.env);
  const since = c.req.query('since');
  const sets = await getExerciseHistory(ctx, c.req.param('id'), { since });
  return c.json({ provenance: 'd1_confirmed', sets });
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
  const [meals, inProgress, body] = await Promise.all([
    getMealsByDate(ctx.db, d),
    getInProgressSession(ctx.db),
    getBodyMetricsByDate(ctx.db, d),
  ]);
  const mealsWithItems = await Promise.all(
    meals.map(async (m) => ({ ...m, items: await getMealItems(ctx.db, m.id) })),
  );
  const pfc = mealsWithItems
    .flatMap((m) => m.items)
    .reduce(
      (a, it) => ({
        kcal: a.kcal + it.calories_kcal,
        p: a.p + it.protein_g,
        f: a.f + it.fat_g,
        c: a.c + it.carbs_g,
      }),
      { kcal: 0, p: 0, f: 0, c: 0 },
    );
  return c.json({
    date: d,
    provenance: 'd1_confirmed',
    meals: mealsWithItems,
    pfc,
    inProgress,
    body,
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

api.post('/meals', async (c) => {
  const ctx = makeContext(c.env);
  const body = (await c.req.json()) as LogMealInput;
  if (!body?.mealType || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'mealType and items required' }, 400);
  }
  const result = await logMeal(ctx, body);
  return c.json(result, 201);
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

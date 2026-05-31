import type { Meal, MealItem } from '../../domain/models';
import { MealItem as MealItemSchema, Meal as MealSchema } from '../../domain/models';
import { nowSec } from '../../util/date';
import { deleteByStmt, insertStmt, runBatch, type Stmt } from '../batch-helpers';
import type { Db } from '../client';

/**
 * 食事永続化(§8.5)。編集は明細 delete+再INSERT を単一 batch に収める。
 * GH 側は anonymous food が immutable なので別途 datapoint を batchDelete→再create(service)。
 */

export async function createMealBatch(db: Db, meal: Meal, items: MealItem[]): Promise<void> {
  const stmts: Stmt[] = [insertStmt('meals', meal as unknown as Record<string, unknown>)];
  for (const it of items) {
    stmts.push(insertStmt('meal_items', it as unknown as Record<string, unknown>));
  }
  await runBatch(db, stmts);
}

/** 食事編集 = meals は同一id UPDATE + 明細 delete→再INSERT を単一 batch(§9.7)。 */
export async function replaceMealItemsBatch(
  db: Db,
  mealId: string,
  patch: { note?: string | null; meal_type?: string },
  items: MealItem[],
): Promise<void> {
  const stmts: Stmt[] = [];
  const sets: string[] = ['updated_at = ?'];
  const binds: unknown[] = [nowSec()];
  if (patch.note !== undefined) {
    sets.push('note = ?');
    binds.push(patch.note);
  }
  if (patch.meal_type !== undefined) {
    sets.push('meal_type = ?');
    binds.push(patch.meal_type);
  }
  binds.push(mealId);
  stmts.push({ sql: `UPDATE meals SET ${sets.join(', ')} WHERE id = ?`, binds });
  stmts.push(deleteByStmt('meal_items', 'meal_id', mealId));
  for (const it of items) {
    stmts.push(insertStmt('meal_items', it as unknown as Record<string, unknown>));
  }
  await runBatch(db, stmts);
}

export async function deleteMeal(db: Db, mealId: string): Promise<void> {
  // meal_items は ON DELETE CASCADE。
  await db.run('DELETE FROM meals WHERE id = ?', mealId);
}

export async function getMealsByDate(db: Db, date: string): Promise<Meal[]> {
  return db.all(MealSchema, 'SELECT * FROM meals WHERE date = ? ORDER BY logged_at', date);
}

export async function getMealItems(db: Db, mealId: string): Promise<MealItem[]> {
  return db.all(MealItemSchema, 'SELECT * FROM meal_items WHERE meal_id = ?', mealId);
}

/** food_name オートコンプリート源(§9.4: 過去PFCの再利用)。 */
export async function autocompleteFoods(db: Db, q: string, limit = 8): Promise<MealItem[]> {
  return db.all(
    MealItemSchema,
    `SELECT * FROM meal_items WHERE food_name LIKE ? GROUP BY food_name ORDER BY max(created_at) DESC LIMIT ?`,
    `%${q}%`,
    limit,
  );
}

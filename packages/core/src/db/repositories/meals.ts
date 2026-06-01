import type { Meal, MealItem } from '../../domain/models';
import { MealItem as MealItemSchema, Meal as MealSchema } from '../../domain/models';
import { nowSec } from '../../util/date';
import { deleteByStmt, insertStmt, runBatch, type Stmt } from '../batch-helpers';
import type { Db } from '../client';
import { ulid } from '../ids';

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

/** D1 から食事削除(meal_items は ON DELETE CASCADE)。public write API は services.deleteMeal。 */
export async function deleteMealRow(db: Db, mealId: string): Promise<void> {
  await db.run('DELETE FROM meals WHERE id = ?', mealId);
}

export async function getMealsByDate(db: Db, date: string): Promise<Meal[]> {
  return db.all(MealSchema, 'SELECT * FROM meals WHERE date = ? ORDER BY logged_at', date);
}

export async function getMealById(db: Db, id: string): Promise<Meal | null> {
  return db.one(MealSchema, 'SELECT * FROM meals WHERE id = ?', id);
}

export async function getMealItems(db: Db, mealId: string): Promise<MealItem[]> {
  return db.all(MealItemSchema, 'SELECT * FROM meal_items WHERE meal_id = ?', mealId);
}

/** food_name オートコンプリート源(§9.4: 過去PFCの再利用)。同名は「最新行そのもの」を返す。 */
export async function autocompleteFoods(db: Db, q: string, limit = 8): Promise<MealItem[]> {
  // bare-column 集約だと max(created_at) の行と他列が一致しないため、相関サブクエリで最新行を取る。
  // LIKE ワイルドカード(%,_)はエスケープして誤マッチを防ぐ(ESCAPE '\\')。
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  return db.all(
    MealItemSchema,
    `SELECT mi.* FROM meal_items mi
      WHERE mi.food_name LIKE ? ESCAPE '\\'
        AND mi.created_at = (
          SELECT max(m2.created_at) FROM meal_items m2 WHERE m2.food_name = mi.food_name)
      GROUP BY mi.food_name
      ORDER BY mi.created_at DESC
      LIMIT ?`,
    pattern,
    limit,
  );
}

// ============ 食事プリセット(「朝の定番」ワンタップ, §9.4) ============
export interface MealPresetRow {
  id: string;
  name: string;
  items_json: string;
  default_meal_type: string;
  use_count: number;
}

export async function listMealPresets(db: Db): Promise<MealPresetRow[]> {
  return db.raw<MealPresetRow>(
    'SELECT id, name, items_json, default_meal_type, use_count FROM meal_presets ORDER BY use_count DESC, updated_at DESC',
  );
}

export async function insertMealPreset(
  db: Db,
  p: { name: string; itemsJson: string; defaultMealType: string },
): Promise<string> {
  const id = ulid();
  const now = nowSec();
  await db.run(
    'INSERT INTO meal_presets (id, name, items_json, default_meal_type, use_count, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    id,
    p.name,
    p.itemsJson,
    p.defaultMealType,
    now,
    now,
  );
  return id;
}

export async function deleteMealPresetRow(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM meal_presets WHERE id = ?', id);
}

export async function bumpPresetUse(db: Db, id: string): Promise<void> {
  await db.run(
    'UPDATE meal_presets SET use_count = use_count + 1, updated_at = ? WHERE id = ?',
    nowSec(),
    id,
  );
}

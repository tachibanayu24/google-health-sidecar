import { NutritionTarget, Settings } from '../../domain/models';
import { todayJst } from '../../util/date';
import type { Db } from '../client';

export async function getSettings(db: Db): Promise<Settings> {
  const s = await db.one(Settings, 'SELECT * FROM settings WHERE id = 1');
  if (!s) throw new Error('settings row (id=1) missing — seed not applied?');
  return s;
}

/** その日に有効な栄養目標(date_from <= date の最新)。 */
export async function getActiveNutritionTarget(
  db: Db,
  date: string = todayJst(),
): Promise<NutritionTarget | null> {
  return db.one(
    NutritionTarget,
    'SELECT * FROM nutrition_targets WHERE date_from <= ? ORDER BY date_from DESC LIMIT 1',
    date,
  );
}

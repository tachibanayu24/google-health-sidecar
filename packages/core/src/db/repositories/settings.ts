import type { E1rmFormula, NutritionPhase, WeightUnit } from '../../domain/enums';
import { NutritionTarget, Settings } from '../../domain/models';
import { todayJst } from '../../util/date';
import type { Db } from '../client';
import { ulid } from '../ids';

export async function getSettings(db: Db): Promise<Settings> {
  const s = await db.one(Settings, 'SELECT * FROM settings WHERE id = 1');
  if (!s) throw new Error('settings row (id=1) missing — seed not applied?');
  return s;
}

/** その日に有効な栄養目標(date_from <= date の最新。同日複数は created_at 新しい方)。 */
export async function getActiveNutritionTarget(
  db: Db,
  date: string = todayJst(),
): Promise<NutritionTarget | null> {
  return db.one(
    NutritionTarget,
    'SELECT * FROM nutrition_targets WHERE date_from <= ? ORDER BY date_from DESC, created_at DESC LIMIT 1',
    date,
  );
}

/** settings(単一行 id=1)を更新。public な write API は services 層(updateSettings)。 */
export async function updateSettingsRow(
  db: Db,
  input: {
    unit_preference: WeightUnit;
    e1rm_formula: E1rmFormula;
    locale: string;
    height_cm?: number | null;
    birth_year?: number | null;
    sex?: 'male' | 'female' | null;
  },
): Promise<void> {
  await db.run(
    `UPDATE settings SET unit_preference=?, e1rm_formula=?, locale=?,
       height_cm=?, birth_year=?, sex=?, updated_at=unixepoch() WHERE id=1`,
    input.unit_preference,
    input.e1rm_formula,
    input.locale,
    input.height_cm ?? null,
    input.birth_year ?? null,
    input.sex ?? null,
  );
}

/** 栄養目標を設定。同 date_from 行があれば上書き(同日再編集)、無ければ新フェーズ行を追加(履歴保持)。 */
export async function setNutritionTargetRow(
  db: Db,
  input: {
    dateFrom: string;
    phase: NutritionPhase;
    kcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
    saltG: number;
    fiberG: number;
  },
): Promise<void> {
  const existing = await db.raw<{ id: string }>(
    'SELECT id FROM nutrition_targets WHERE date_from=? LIMIT 1',
    input.dateFrom,
  );
  if (existing[0]?.id) {
    await db.run(
      'UPDATE nutrition_targets SET phase=?, target_kcal=?, target_protein_g=?, target_fat_g=?, target_carbs_g=?, target_salt_g=?, target_fiber_g=? WHERE id=?',
      input.phase,
      input.kcal,
      input.proteinG,
      input.fatG,
      input.carbsG,
      input.saltG,
      input.fiberG,
      existing[0].id,
    );
  } else {
    await db.run(
      'INSERT INTO nutrition_targets (id, date_from, phase, target_kcal, target_protein_g, target_fat_g, target_carbs_g, target_salt_g, target_fiber_g) VALUES (?,?,?,?,?,?,?,?,?)',
      ulid(),
      input.dateFrom,
      input.phase,
      input.kcal,
      input.proteinG,
      input.fatG,
      input.carbsG,
      input.saltG,
      input.fiberG,
    );
  }
}

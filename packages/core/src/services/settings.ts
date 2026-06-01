import { setNutritionTargetRow, updateSettingsRow } from '../db/repositories/settings';
import type { E1rmFormula, NutritionPhase, WeightUnit } from '../domain/enums';
import { todayJst } from '../util/date';
import type { AppContext } from './context';

/**
 * 設定・栄養目標の更新(§8.5: write は services 経由)。いずれも D1 のみ(GH 非ミラー)。
 */

export interface UpdateSettingsInput {
  unitPreference: WeightUnit;
  e1rmFormula: E1rmFormula;
  locale?: string;
}

export async function updateSettings(ctx: AppContext, input: UpdateSettingsInput): Promise<void> {
  await updateSettingsRow(ctx.db, {
    unit_preference: input.unitPreference,
    e1rm_formula: input.e1rmFormula,
    locale: input.locale ?? 'ja',
  });
}

export interface SetNutritionTargetInput {
  phase: NutritionPhase;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  saltG?: number;
  /** 適用開始日(既定=今日)。過去と異なれば新フェーズ行、同日なら上書き。 */
  dateFrom?: string;
}

export async function setNutritionTarget(
  ctx: AppContext,
  input: SetNutritionTargetInput,
): Promise<void> {
  await setNutritionTargetRow(ctx.db, {
    dateFrom: input.dateFrom ?? todayJst(),
    phase: input.phase,
    kcal: input.kcal,
    proteinG: input.proteinG,
    fatG: input.fatG,
    carbsG: input.carbsG,
    saltG: input.saltG ?? 6,
  });
}

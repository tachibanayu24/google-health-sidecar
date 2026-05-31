import { insertStmt, runBatch, type Stmt } from '../db/batch-helpers';
import { ulid } from '../db/ids';
import {
  markPushFailed,
  markPushSynced,
  pendingPushStmt,
  skippedPushStmt,
} from '../db/repositories/sync';
import type { MealInputMethod, MealType } from '../domain/enums';
import { MEAL_TYPE_TO_GH } from '../domain/enums';
import { nowSec, todayJst } from '../util/date';
import { errorMessage } from '../util/errors';
import { type AppContext, getProvider } from './context';

export interface MealItemInput {
  foodName: string;
  quantity?: number;
  unit?: string;
  caloriesKcal: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
}
export interface LogMealInput {
  date?: string;
  loggedAtSec?: number;
  mealType: MealType;
  note?: string;
  inputMethod?: MealInputMethod;
  items: MealItemInput[];
}

/**
 * 食事記録(§8.5: meal + items を単一 batch、§5.2: GH push は flag付き best-effort)。
 * D1 が正本なので flag OFF / 403 でも記録は失われない。
 */
export async function logMeal(
  ctx: AppContext,
  input: LogMealInput,
): Promise<{ mealId: string; ghPushed: boolean }> {
  const now = nowSec();
  const mealId = ulid();
  const date = input.date ?? todayJst();
  const loggedAt = input.loggedAtSec ?? now;

  const stmts: Stmt[] = [
    insertStmt('meals', {
      id: mealId,
      date,
      logged_at: loggedAt,
      meal_type: input.mealType,
      note: input.note ?? null,
      photo_r2_key: null,
      input_method: input.inputMethod ?? 'manual',
      created_at: now,
      updated_at: now,
    }),
  ];
  for (const it of input.items) {
    stmts.push(
      insertStmt('meal_items', {
        id: ulid(),
        meal_id: mealId,
        preset_id: null,
        food_name: it.foodName,
        quantity: it.quantity ?? 1,
        unit: it.unit ?? 'serving',
        calories_kcal: it.caloriesKcal,
        protein_g: it.proteinG ?? 0,
        fat_g: it.fatG ?? 0,
        carbs_g: it.carbsG ?? 0,
        fiber_g: it.fiberG ?? null,
        sugar_g: it.sugarG ?? null,
        sodium_mg: it.sodiumMg ?? null,
        created_at: now,
      }),
    );
  }
  // GH push 台帳: flag ON なら pending、OFF なら skipped_flag_off(§5.2)。
  stmts.push(
    ctx.featureGhNutritionPush ? pendingPushStmt('meal', mealId) : skippedPushStmt('meal', mealId),
  );
  await runBatch(ctx.db, stmts); // ★原子的

  let ghPushed = false;
  if (ctx.featureGhNutritionPush && ctx.pushInline !== false) {
    ghPushed = await pushMeal(ctx, mealId, input);
  }
  return { mealId, ghPushed };
}

async function pushMeal(ctx: AppContext, mealId: string, input: LogMealInput): Promise<boolean> {
  try {
    const provider = getProvider(ctx);
    // 食事は items を合算した1 nutrition-log として push(anonymous food)。
    const sum = input.items.reduce(
      (a, it) => ({
        kcal: a.kcal + it.caloriesKcal,
        p: a.p + (it.proteinG ?? 0),
        f: a.f + (it.fatG ?? 0),
        c: a.c + (it.carbsG ?? 0),
      }),
      { kcal: 0, p: 0, f: 0, c: 0 },
    );
    const name =
      input.items.length === 1
        ? input.items[0]!.foodName
        : `${input.mealType} (${input.items.length}品)`;
    const res = await provider.pushNutrition({
      atSec: input.loggedAtSec ?? nowSec(),
      mealType: MEAL_TYPE_TO_GH[input.mealType],
      foodDisplayName: name,
      kcal: sum.kcal,
      proteinG: sum.p,
      fatG: sum.f,
      carbsG: sum.c,
      clientTag: mealId,
    });
    await markPushSynced(ctx.db, 'meal', mealId, res.datapointId, res.dataOrigin, null);
    return true;
  } catch (e) {
    await markPushFailed(ctx.db, 'meal', mealId, errorMessage(e));
    return false;
  }
}

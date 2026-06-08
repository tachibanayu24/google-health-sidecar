import { insertStmt, runBatch, type Stmt } from '../db/batch-helpers';
import { ulid } from '../db/ids';
import { bumpPresetUse, insertMealPreset, listMealPresets } from '../db/repositories/meals';
import {
  markPushFailed,
  markPushSynced,
  pendingPushStmt,
  skippedPushStmt,
} from '../db/repositories/sync';
import type { MealInputMethod, MealType } from '../domain/enums';
import { MEAL_TYPE_TO_GH } from '../domain/enums';
import { MealItemInputSchema } from '../domain/inputs';
import { WRITE_DATATYPE } from '../providers/google-health/discovery-pin';
import { nowSec, todayJst } from '../util/date';
import { DomainError, errorMessage } from '../util/errors';
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
  /** プリセット由来なら使用回数を加算(任意)。 */
  presetId?: string;
  /** 冪等キー(client 生成 UUID)。オフライン再送/MCP リトライの二重登録を防止(§9.8)。 */
  clientRequestId?: string;
}

/**
 * 食事記録(§8.5: meal + items を単一 batch、§5.2: GH push は flag付き best-effort)。
 * D1 が正本なので flag OFF / 403 でも記録は失われない。
 */
export async function logMeal(
  ctx: AppContext,
  input: LogMealInput,
): Promise<{ mealId: string; ghPushed: boolean; idempotentHit: boolean }> {
  const now = nowSec();
  // 冪等: 同じ client_request_id の食事が既にあれば再登録しない(オフライン再送/MCPリトライ, §9.8)。
  if (input.clientRequestId) {
    const ex = await ctx.db.raw<{ id: string }>(
      'SELECT id FROM meals WHERE client_request_id = ? LIMIT 1',
      input.clientRequestId,
    );
    // 冪等ヒット: idempotentHit=true で『新規記録』と区別(ghPushed は初回送信時の値を見ること)。
    if (ex[0]) return { mealId: ex[0].id, ghPushed: false, idempotentHit: true };
  }
  const mealId = ulid();
  const date = input.date ?? todayJst();
  const loggedAt = input.loggedAtSec ?? now;
  const inputMethod = input.presetId ? 'preset' : (input.inputMethod ?? 'manual');

  const stmts: Stmt[] = [
    insertStmt('meals', {
      id: mealId,
      date,
      logged_at: loggedAt,
      meal_type: input.mealType,
      note: input.note ?? null,
      photo_r2_key: null,
      input_method: inputMethod,
      client_request_id: input.clientRequestId ?? null,
      created_at: now,
      updated_at: now,
    }),
  ];
  for (const it of input.items) {
    stmts.push(
      insertStmt('meal_items', {
        id: ulid(),
        meal_id: mealId,
        preset_id: input.presetId ?? null,
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

  if (input.presetId) await bumpPresetUse(ctx.db, input.presetId); // プリセット使用回数

  let ghPushed = false;
  if (ctx.featureGhNutritionPush && ctx.pushInline !== false) {
    ghPushed = await pushMeal(ctx, mealId, input);
  }
  return { mealId, ghPushed, idempotentHit: false };
}

/** 現在の食事内容をプリセット保存(「朝の定番」等)。items は MealItemInput[] を JSON 化。 */
export async function saveMealPreset(
  ctx: AppContext,
  input: { name: string; defaultMealType: MealType; items: MealItemInput[] },
): Promise<{ presetId: string }> {
  const presetId = await insertMealPreset(ctx.db, {
    name: input.name,
    itemsJson: JSON.stringify(input.items),
    defaultMealType: input.defaultMealType,
  });
  return { presetId };
}

/**
 * プリセットから食事を記録(§9.4)。`servings` 倍率で全栄養素を按分する。
 * 例: 30g の WPI を 1 serving として登録 → 40g 摂取は servings=1.3333 で各値 ×1.3333。
 * スケールは入力整形に留め、書き込みは logMeal(§8.5 全write一点経由)へ委譲。
 */
export async function logMealFromPreset(
  ctx: AppContext,
  input: {
    presetId: string;
    servings?: number;
    mealType?: MealType;
    date?: string;
    loggedAtSec?: number;
    note?: string;
    clientRequestId?: string;
  },
): Promise<{ mealId: string; ghPushed: boolean; idempotentHit: boolean }> {
  const preset = (await listMealPresets(ctx.db)).find((p) => p.id === input.presetId);
  if (!preset) throw new DomainError(`プリセットが見つかりません: "${input.presetId}"`);
  const base = MealItemInputSchema.array().parse(JSON.parse(preset.items_json));
  const m = input.servings ?? 1;
  if (m <= 0) throw new DomainError('servings は正の数で指定してください');
  const r1 = (n: number) => Math.round(n * 10) / 10; // 0.1 単位に丸め
  const scale = (n: number | undefined) => (n == null ? undefined : r1(n * m));
  const items = base.map((it) => ({
    ...it,
    quantity: r1((it.quantity ?? 1) * m),
    caloriesKcal: r1(it.caloriesKcal * m),
    proteinG: scale(it.proteinG),
    fatG: scale(it.fatG),
    carbsG: scale(it.carbsG),
    fiberG: scale(it.fiberG),
    sugarG: scale(it.sugarG),
    sodiumMg: scale(it.sodiumMg),
  }));
  return logMeal(ctx, {
    mealType: input.mealType ?? (preset.default_meal_type as MealType),
    items,
    presetId: input.presetId,
    date: input.date,
    loggedAtSec: input.loggedAtSec,
    note: input.note,
    inputMethod: 'preset',
    clientRequestId: input.clientRequestId,
  });
}

async function pushMeal(ctx: AppContext, mealId: string, input: LogMealInput): Promise<boolean> {
  try {
    const provider = getProvider(ctx);
    // 食事は items を合算した1 nutrition-log として push(anonymous food)。
    // sodium/fiber/sugar も含め GH へ忠実に送る(claude→logbook→GH の一方向同期の完全性, §5.2)。
    const sum = input.items.reduce(
      (a, it) => ({
        kcal: a.kcal + it.caloriesKcal,
        p: a.p + (it.proteinG ?? 0),
        f: a.f + (it.fatG ?? 0),
        c: a.c + (it.carbsG ?? 0),
        na: a.na + (it.sodiumMg ?? 0),
        fiber: a.fiber + (it.fiberG ?? 0),
        sugar: a.sugar + (it.sugarG ?? 0),
      }),
      { kcal: 0, p: 0, f: 0, c: 0, na: 0, fiber: 0, sugar: 0 },
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
      sodiumMg: sum.na || undefined,
      fiberG: sum.fiber || undefined,
      sugarG: sum.sugar || undefined,
      clientTag: mealId,
    });
    await markPushSynced(ctx.db, 'meal', mealId, res.datapointId, res.dataOrigin, null);
    return true;
  } catch (e) {
    await markPushFailed(ctx.db, 'meal', mealId, errorMessage(e));
    return false;
  }
}

/**
 * 食事削除(§8.5)。D1 を正本として削除し、GH に push 済みなら datapoint を best-effort で batchDelete。
 * GH 削除失敗でも D1 削除は行う(正本優先)。
 */
export async function deleteMeal(
  ctx: AppContext,
  mealId: string,
): Promise<{ deleted: boolean; ghDeleted: boolean }> {
  const rows = await ctx.db.raw<{ gh_datapoint_id: string | null }>(
    "SELECT gh_datapoint_id FROM gh_sync_state WHERE entity_type='meal' AND entity_id=?",
    mealId,
  );
  const dpId = rows[0]?.gh_datapoint_id ?? null;
  // §8.5/§12.6: D1 正本を先に削除し、その後 GH datapoint を best-effort で batchDelete(D1→GH 順)。
  // 先に GH を消すと GH 成功直後・D1 batch 前の停止で false-synced(D1残/GH消)になりうるため D1 先行。
  // §8.5: 台帳と本体の削除を単一 batch で原子的に(中断時の孤児 entity_id を防ぐ)。meal_items は CASCADE。
  await runBatch(ctx.db, [
    {
      sql: "DELETE FROM gh_sync_state WHERE entity_type='meal' AND entity_id=?",
      binds: [mealId],
    },
    { sql: 'DELETE FROM meals WHERE id=?', binds: [mealId] },
  ]);
  let ghDeleted = false;
  if (dpId && ctx.featureGhNutritionPush) {
    try {
      await getProvider(ctx).batchDelete(WRITE_DATATYPE.nutrition, [dpId]);
      ghDeleted = true;
    } catch {
      /* best-effort: GH 削除に失敗しても D1 正本は削除済み */
    }
  }
  return { deleted: true, ghDeleted };
}

import { z } from 'zod';
import { LoadMode, MealInputMethod, MealType, SetType, WeightUnit } from './enums';

/**
 * API/MCP の書込入力スキーマ(§9.8)。web routes と MCP の双方がここを唯一の契約として参照し、
 * service 層に渡す前に safeParse で弾く(不正入力は 500 ではなく 400)。z.infer は service の
 * 入力 interface と構造的に一致する(LogMealInput / SaveWorkoutInput)。
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date は YYYY-MM-DD')
  .optional();
const epochSec = z.number().int().nonnegative();

export const LogMealInputSchema = z.object({
  date: isoDate,
  loggedAtSec: epochSec.optional(),
  mealType: MealType,
  note: z.string().max(500).optional(),
  inputMethod: MealInputMethod.optional(),
  presetId: z.string().min(1).optional(),
  clientRequestId: z.string().min(1).max(64).optional(),
  items: z
    .array(
      z.object({
        foodName: z.string().min(1).max(120),
        quantity: z.number().positive().optional(),
        unit: z.string().max(20).optional(),
        caloriesKcal: z.number().min(0).max(20000),
        proteinG: z.number().min(0).max(2000).optional(),
        fatG: z.number().min(0).max(2000).optional(),
        carbsG: z.number().min(0).max(2000).optional(),
        fiberG: z.number().min(0).max(500).optional(),
        sugarG: z.number().min(0).max(2000).optional(),
        sodiumMg: z.number().min(0).max(100000).optional(),
      }),
    )
    .min(1, '食事には最低1品必要')
    .max(50),
});
export type LogMealInputParsed = z.infer<typeof LogMealInputSchema>;

const SetInputSchema = z.object({
  setType: SetType.optional(),
  loadMode: LoadMode.optional(),
  entryValue: z.number().min(0).max(2000).nullable().optional(),
  entryUnit: WeightUnit.optional(),
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  rpe: z.number().min(0).max(10).nullable().optional(),
  restSec: z.number().int().min(0).max(7200).nullable().optional(),
  performedAtSec: epochSec.nullable().optional(),
});

export const SaveWorkoutInputSchema = z.object({
  date: isoDate,
  title: z.string().max(120).optional(),
  startedAtSec: epochSec.optional(),
  endedAtSec: epochSec.optional(),
  bodyweightKg: z.number().positive().max(500).nullable().optional(),
  status: z.enum(['in_progress', 'completed']).optional(),
  clientRequestId: z.string().min(1).max(64).optional(),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().min(1),
        note: z.string().max(500).optional(),
        sets: z.array(SetInputSchema).max(50),
      }),
    )
    .min(1, 'ワークアウトには最低1種目必要')
    .max(40),
});
export type SaveWorkoutInputParsed = z.infer<typeof SaveWorkoutInputSchema>;

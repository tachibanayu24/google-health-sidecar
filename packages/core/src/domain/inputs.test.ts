import { describe, expect, it } from 'vitest';
import { LogMealInputSchema, SaveWorkoutInputSchema } from './inputs';

describe('LogMealInputSchema', () => {
  const valid = {
    mealType: 'Breakfast',
    items: [{ foodName: '鶏胸肉', caloriesKcal: 165, proteinG: 31 }],
  };

  it('最小の正当入力を通す', () => {
    expect(LogMealInputSchema.safeParse(valid).success).toBe(true);
  });

  it('items が空なら弾く', () => {
    expect(LogMealInputSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
  });

  it('不明な mealType を弾く', () => {
    expect(LogMealInputSchema.safeParse({ ...valid, mealType: 'Brunch' }).success).toBe(false);
  });

  it('負の kcal を弾く', () => {
    const r = LogMealInputSchema.safeParse({
      ...valid,
      items: [{ foodName: 'x', caloriesKcal: -10 }],
    });
    expect(r.success).toBe(false);
  });

  it('foodName 空文字を弾く', () => {
    const r = LogMealInputSchema.safeParse({
      ...valid,
      items: [{ foodName: '', caloriesKcal: 100 }],
    });
    expect(r.success).toBe(false);
  });

  it('不正な date 形式を弾く', () => {
    expect(LogMealInputSchema.safeParse({ ...valid, date: '2026/06/01' }).success).toBe(false);
  });

  it('clientRequestId / presetId を許容する', () => {
    const r = LogMealInputSchema.safeParse({
      ...valid,
      clientRequestId: 'abc-123',
      presetId: 'pr_1',
    });
    expect(r.success).toBe(true);
  });
});

describe('SaveWorkoutInputSchema', () => {
  const valid = {
    exercises: [
      {
        exerciseId: 'ex_bench',
        sets: [{ setType: 'main', entryValue: 80, reps: 5, entryUnit: 'kg' }],
      },
    ],
  };

  it('最小の正当入力を通す', () => {
    expect(SaveWorkoutInputSchema.safeParse(valid).success).toBe(true);
  });

  it('exercises が空なら弾く', () => {
    expect(SaveWorkoutInputSchema.safeParse({ exercises: [] }).success).toBe(false);
  });

  it('exerciseId 空文字を弾く', () => {
    const r = SaveWorkoutInputSchema.safeParse({
      exercises: [{ exerciseId: '', sets: [] }],
    });
    expect(r.success).toBe(false);
  });

  it('RPE が範囲外(>10)なら弾く', () => {
    const r = SaveWorkoutInputSchema.safeParse({
      exercises: [{ exerciseId: 'ex', sets: [{ rpe: 12 }] }],
    });
    expect(r.success).toBe(false);
  });

  it('不正な setType を弾く', () => {
    const r = SaveWorkoutInputSchema.safeParse({
      exercises: [{ exerciseId: 'ex', sets: [{ setType: 'megaset' }] }],
    });
    expect(r.success).toBe(false);
  });

  it('負の bodyweight を弾く', () => {
    expect(SaveWorkoutInputSchema.safeParse({ ...valid, bodyweightKg: -5 }).success).toBe(false);
  });

  it('null reps / entryValue(自重種目)を許容する', () => {
    const r = SaveWorkoutInputSchema.safeParse({
      exercises: [{ exerciseId: 'ex', sets: [{ setType: 'main', entryValue: null, reps: null }] }],
    });
    expect(r.success).toBe(true);
  });
});

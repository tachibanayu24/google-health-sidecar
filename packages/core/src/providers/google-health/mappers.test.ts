import { describe, expect, it } from 'vitest';
import {
  APP_DATA_ORIGIN,
  buildBodyPayload,
  buildExercisePayload,
  buildNutritionPayload,
  parseCreateResponse,
  parseReconcileResponse,
} from './mappers';

describe('buildExercisePayload', () => {
  it('STRENGTH_TRAINING サマリ + 逆引きタグ', () => {
    const p = buildExercisePayload({
      startSec: 1_700_000_000,
      endSec: 1_700_003_600,
      exerciseType: 'STRENGTH_TRAINING',
      displayName: '胸の日',
      activeDurationSec: 3600,
      calories: 320,
      notes: 'Bench 60kg×8×3',
      clientTag: 'session_abc',
    }) as Record<string, any>;
    expect(p.exerciseType).toBe('STRENGTH_TRAINING');
    expect(p.exerciseMetadata.activeDuration).toBe('3600s');
    expect(p.exerciseMetadata.notes).toContain('[ghsidecar:session_abc]');
    expect(p.metricsSummary.calories.kcal).toBe(320);
    expect(p.dataSource.application).toBe(APP_DATA_ORIGIN);
  });

  it('calories 無しなら metricsSummary を含めない', () => {
    const p = buildExercisePayload({
      startSec: 1,
      endSec: 2,
      exerciseType: 'STRENGTH_TRAINING',
      displayName: 'x',
      activeDurationSec: 1,
      clientTag: 't',
    }) as Record<string, any>;
    expect(p.metricsSummary).toBeUndefined();
  });
});

describe('buildNutritionPayload', () => {
  it('nutrients を enum 名で積む。sodium は mg→g', () => {
    const p = buildNutritionPayload({
      atSec: 1_700_000_000,
      mealType: 'LUNCH',
      foodDisplayName: '鶏胸肉',
      kcal: 330,
      proteinG: 60,
      fatG: 7,
      carbsG: 0,
      sodiumMg: 500,
      clientTag: 'meal_1',
    }) as Record<string, any>;
    expect(p.mealType).toBe('LUNCH');
    expect(p.foodDisplayName).toBe('鶏胸肉');
    expect(p.energy.kcal).toBe(330);
    const protein = p.nutrients.find((n: any) => n.nutrient === 'PROTEIN');
    expect(protein.quantity.grams).toBe(60);
    const sodium = p.nutrients.find((n: any) => n.nutrient === 'SODIUM');
    expect(sodium.quantity.grams).toBeCloseTo(0.5, 6);
  });

  it('未指定の栄養素は nutrients に含めない', () => {
    const p = buildNutritionPayload({
      atSec: 1,
      mealType: 'SNACK',
      foodDisplayName: 'x',
      kcal: 100,
      clientTag: 't',
    }) as Record<string, any>;
    expect(p.nutrients).toHaveLength(0);
  });
});

describe('buildBodyPayload', () => {
  it('weight は MANUAL + kilograms', () => {
    const p = buildBodyPayload({
      kind: 'weight',
      sampleTimeSec: 1_700_000_000,
      weightKg: 72.4,
      recordingMethod: 'MANUAL',
      clientTag: 'bm_1',
    }) as Record<string, any>;
    expect(p.dataSource.recordingMethod).toBe('MANUAL');
    expect(p.weight.kilograms).toBe(72.4);
  });

  it('body-fat は percentage', () => {
    const p = buildBodyPayload({
      kind: 'body-fat',
      sampleTimeSec: 1,
      bodyFatPct: 15.5,
      recordingMethod: 'MANUAL',
      clientTag: 'bm_2',
    }) as Record<string, any>;
    expect(p.bodyFat.percentage).toBe(15.5);
  });
});

describe('parse helpers', () => {
  it('parseCreateResponse name→datapointId', () => {
    const r = parseCreateResponse({
      name: 'users/me/.../dp123',
      dataSource: { application: 'ghsidecar' },
    });
    expect(r.datapointId).toBe('users/me/.../dp123');
    expect(r.dataOrigin).toBe('ghsidecar');
  });

  it('parseReconcileResponse: weight points + cursor', () => {
    const { points, cursor } = parseReconcileResponse('weight', {
      dataPoints: [
        {
          name: 'dp1',
          sampleTime: { physicalTime: '2026-05-30T07:00:00Z' },
          weight: { kilograms: 72.1 },
          dataSource: { application: 'ghsidecar', recordingMethod: 'MANUAL' },
        },
      ],
      nextPageToken: 'tok',
    });
    expect(points).toHaveLength(1);
    expect(points[0]?.value).toBe(72.1);
    expect(points[0]?.dataOrigin).toBe('ghsidecar');
    expect(points[0]?.recordingMethod).toBe('MANUAL');
    expect(cursor).toBe('tok');
  });
});

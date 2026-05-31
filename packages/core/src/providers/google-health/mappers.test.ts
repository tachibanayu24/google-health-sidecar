import { describe, expect, it } from 'vitest';
import {
  APP_DATA_ORIGIN,
  buildBodyPayload,
  buildExercisePayload,
  buildNutritionPayload,
  mapDataPoint,
  parseCreateResponse,
  parseReconcileResponse,
} from './mappers';

// ============ write payload(discovery doc 準拠) ============
describe('buildExercisePayload', () => {
  it('exercise sub-object に top-level displayName/activeDuration/notes、calories=metricsSummary.caloriesKcal', () => {
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
    expect(p.exercise.exerciseType).toBe('STRENGTH_TRAINING');
    expect(p.exercise.displayName).toBe('胸の日'); // ★top-level
    expect(p.exercise.activeDuration).toBe('3600s');
    expect(p.exercise.notes).toContain('[ghsidecar:session_abc]');
    expect(p.exercise.metricsSummary.caloriesKcal).toBe(320);
    expect(p.dataSource.application.name).toBe(APP_DATA_ORIGIN);
    expect(p.dataSource.recordingMethod).toBe('ACTIVELY_RECORDED');
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
    expect(p.exercise.metricsSummary).toBeUndefined();
  });
});

describe('buildNutritionPayload', () => {
  it('nutritionLog.foodName / mealType enum / caloriesKcal、sodium は mg→g', () => {
    const p = buildNutritionPayload({
      atSec: 1_700_000_000,
      mealType: 'LUNCH',
      foodDisplayName: '鶏胸肉',
      kcal: 330,
      proteinG: 60,
      sodiumMg: 500,
      clientTag: 'meal_1',
    }) as Record<string, any>;
    expect(p.nutritionLog.foodName).toBe('鶏胸肉'); // ★foodName
    expect(p.nutritionLog.mealType).toBe('LUNCH');
    expect(p.nutritionLog.caloriesKcal).toBe(330);
    const sodium = p.nutritionLog.nutrients.find((n: any) => n.nutrient === 'SODIUM');
    expect(sodium.quantity.grams).toBeCloseTo(0.5, 6);
  });
});

describe('buildBodyPayload', () => {
  it('weight は weightGrams(kg×1000)', () => {
    const p = buildBodyPayload({
      kind: 'weight',
      sampleTimeSec: 1_700_000_000,
      weightKg: 72.4,
      clientTag: 'bm_1',
    }) as Record<string, any>;
    expect(p.weight.weightGrams).toBe(72400); // ★grams
    expect(p.dataSource.recordingMethod).toBe('ACTIVELY_RECORDED');
  });
  it('body-fat は percentage', () => {
    const p = buildBodyPayload({
      kind: 'body-fat',
      sampleTimeSec: 1,
      bodyFatPct: 15.5,
      clientTag: 'bm_2',
    }) as Record<string, any>;
    expect(p.bodyFat.percentage).toBe(15.5);
  });
});

// ============ response parse ============
describe('parseCreateResponse', () => {
  it('Operation response.name 優先、無ければ直下 name', () => {
    expect(parseCreateResponse({ response: { name: 'dp/op' } }).datapointId).toBe('dp/op');
    expect(parseCreateResponse({ name: 'dp/bare' }).datapointId).toBe('dp/bare');
  });
});

describe('mapDataPoint: 値は typed sub-object 配下', () => {
  it('weight: weightGrams(int64文字列) → kg', () => {
    const dp = mapDataPoint('weight', {
      name: 'dp1',
      weight: { weightGrams: '72100', sampleTime: { physicalTime: '2026-05-30T07:00:00Z' } },
      dataSource: { application: { name: 'ghsidecar' }, recordingMethod: 'ACTIVELY_RECORDED' },
    });
    expect(dp.value).toBeCloseTo(72.1, 3);
    expect(dp.dataOrigin).toBe('ghsidecar');
    expect(dp.timeSec).toBe(Math.floor(Date.parse('2026-05-30T07:00:00Z') / 1000));
  });

  it('steps: int64 文字列 count + interval.startTime', () => {
    const dp = mapDataPoint('steps', {
      name: 'dp2',
      steps: { count: '8423', interval: { startTime: '2026-05-30T00:00:00Z' } },
    });
    expect(dp.value).toBe(8423); // 文字列でも数値化
    expect(dp.timeSec).toBe(Math.floor(Date.parse('2026-05-30T00:00:00Z') / 1000));
  });

  it('daily-resting-heart-rate: beatsPerMinute(int64文字列) + Date型', () => {
    const dp = mapDataPoint('daily-resting-heart-rate', {
      dailyRestingHeartRate: { beatsPerMinute: '52', date: { year: 2026, month: 5, day: 30 } },
    });
    expect(dp.value).toBe(52);
    expect(dp.timeSec).toBe(Math.floor(Date.UTC(2026, 4, 30) / 1000)); // month-1
  });

  it('daily-heart-rate-variability: averageHeartRateVariabilityMilliseconds(double)', () => {
    const dp = mapDataPoint('daily-heart-rate-variability', {
      dailyHeartRateVariability: {
        averageHeartRateVariabilityMilliseconds: 42.5,
        date: { year: 2026, month: 5, day: 30 },
      },
    });
    expect(dp.value).toBe(42.5);
  });

  it('daily-oxygen-saturation: percentage / daily-vo2-max: vo2MaxMlPerKgPerMinute', () => {
    expect(
      mapDataPoint('daily-oxygen-saturation', {
        dailyOxygenSaturation: { percentage: 97.2, date: { year: 2026, month: 5, day: 30 } },
      }).value,
    ).toBe(97.2);
    expect(
      mapDataPoint('daily-vo2-max', {
        dailyVo2Max: { vo2MaxMlPerKgPerMinute: 48.1, date: { year: 2026, month: 5, day: 30 } },
      }).value,
    ).toBe(48.1);
  });

  it('sleep: summary.minutesAsleep + stagesSummary + efficiency 導出', () => {
    const dp = mapDataPoint('sleep', {
      name: 'sl1',
      sleep: {
        interval: { startTime: '2026-05-29T23:00:00Z' },
        summary: { minutesAsleep: 432, minutesInSleepPeriod: 480 },
        stagesSummary: [
          { type: 'DEEP', minutes: 80 },
          { type: 'LIGHT', minutes: 250 },
          { type: 'REM', minutes: 102 },
          { type: 'AWAKE', minutes: 48 },
        ],
      },
    });
    expect(dp.extra?.total_min).toBe(432);
    expect(dp.extra?.deep_min).toBe(80);
    expect(dp.extra?.rem_min).toBe(102);
    expect(dp.extra?.efficiency).toBe(90); // 432/480 = 90%
  });
});

describe('parseReconcileResponse', () => {
  it('dataPoints[] + nextPageToken', () => {
    const { points, cursor } = parseReconcileResponse('weight', {
      dataPoints: [
        {
          name: 'a',
          weight: { weightGrams: '70000', sampleTime: { physicalTime: '2026-05-30T07:00:00Z' } },
        },
      ],
      nextPageToken: 'tok',
    });
    expect(points).toHaveLength(1);
    expect(points[0]?.value).toBe(70);
    expect(cursor).toBe('tok');
  });
});

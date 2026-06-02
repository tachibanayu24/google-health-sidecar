import { describe, expect, it } from 'vitest';
import {
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
    expect(p.dataSource.recordingMethod).toBe('ACTIVELY_MEASURED');
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
  it('foodDisplayName / mealType enum / energy{kcal} / 炭水・脂質は top-level、sodium は mg→g', () => {
    const p = buildNutritionPayload({
      atSec: 1_700_000_000,
      mealType: 'LUNCH',
      foodDisplayName: '鶏胸肉',
      kcal: 330,
      proteinG: 60,
      fatG: 4,
      carbsG: 2,
      fiberG: 1,
      sodiumMg: 500,
      clientTag: 'meal_1',
    }) as Record<string, any>;
    expect(p.nutritionLog.foodDisplayName).toBe('鶏胸肉'); // ★foodDisplayName
    expect(p.nutritionLog.mealType).toBe('LUNCH');
    // GH は start<end 必須(同時刻は 400)
    expect(Date.parse(p.nutritionLog.interval.endTime)).toBeGreaterThan(
      Date.parse(p.nutritionLog.interval.startTime),
    );
    expect(p.nutritionLog.energy.kcal).toBe(330); // ★EnergyQuantity
    expect(p.nutritionLog.totalCarbohydrate.grams).toBe(2); // ★top-level WeightQuantity
    expect(p.nutritionLog.totalFat.grams).toBe(4);
    const names = p.nutritionLog.nutrients.map((n: any) => n.nutrient);
    expect(names).toContain('PROTEIN');
    expect(names).toContain('DIETARY_FIBER');
    expect(names).not.toContain('TOTAL_FAT'); // enum 非対応 → top-level に逃がす
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
    expect(p.dataSource.recordingMethod).toBe('ACTIVELY_MEASURED');
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

  it('daily-oxygen-saturation: averagePercentage / vo2-max / respiratory: breathsPerMinute', () => {
    expect(
      mapDataPoint('daily-oxygen-saturation', {
        dailyOxygenSaturation: { averagePercentage: 97.2, date: { year: 2026, month: 5, day: 30 } },
      }).value,
    ).toBe(97.2);
    expect(
      mapDataPoint('daily-vo2-max', {
        dailyVo2Max: { vo2MaxMlPerKgPerMinute: 48.1, date: { year: 2026, month: 5, day: 30 } },
      }).value,
    ).toBe(48.1);
    const resp = mapDataPoint('daily-respiratory-rate', {
      dailyRespiratoryRate: { breathsPerMinute: 13.8, date: { year: 2026, month: 5, day: 30 } },
    });
    expect(resp.value).toBe(13.8);
    expect(resp.timeSec).toBe(Math.floor(Date.UTC(2026, 4, 30) / 1000));
  });

  it('sleep: summary.minutesAsleep + stagesSummary + efficiency 導出', () => {
    const dp = mapDataPoint('sleep', {
      name: 'sl1',
      sleep: {
        interval: { startTime: '2026-05-29T23:00:00Z' },
        summary: {
          minutesAsleep: 432,
          minutesInSleepPeriod: 480,
          // ★stagesSummary は summary 配下、minutes は int64 文字列
          stagesSummary: [
            { type: 'DEEP', minutes: '80' },
            { type: 'LIGHT', minutes: '250' },
            { type: 'REM', minutes: '102' },
            { type: 'AWAKE', minutes: '48' },
          ],
        },
      },
    });
    expect(dp.extra?.total_min).toBe(432);
    expect(dp.extra?.deep_min).toBe(80);
    expect(dp.extra?.rem_min).toBe(102);
    expect(dp.extra?.efficiency).toBe(90); // 432/480 = 90%
  });

  it('body-fat: bodyFat.percentage + sampleTime.physicalTime', () => {
    const dp = mapDataPoint('body-fat', {
      name: 'bf1',
      bodyFat: { percentage: 15.5, sampleTime: { physicalTime: '2026-05-30T07:00:00Z' } },
    });
    expect(dp.value).toBe(15.5);
    expect(dp.timeSec).toBe(Math.floor(Date.parse('2026-05-30T07:00:00Z') / 1000));
  });

  it('active-energy-burned: activeEnergyBurned.kcal + interval.startTime(消費kcal日次集計の回帰防止)', () => {
    const dp = mapDataPoint('active-energy-burned', {
      name: 'ae1',
      activeEnergyBurned: { kcal: 5, interval: { startTime: '2026-05-30T12:00:00Z' } },
    });
    expect(dp.value).toBe(5); // フィールド名取り違えだと黙って 0 になる
    expect(dp.timeSec).toBe(Math.floor(Date.parse('2026-05-30T12:00:00Z') / 1000));
  });

  it('daily-sleep-temperature-derivations: nightlyTemperatureCelsius + date(皮膚温の正ID)', () => {
    const dp = mapDataPoint('daily-sleep-temperature-derivations', {
      dailySleepTemperatureDerivations: {
        date: { year: 2026, month: 6, day: 2 },
        nightlyTemperatureCelsius: 34.05,
        baselineTemperatureCelsius: 34.02,
        relativeNightlyStddev30dCelsius: 0.36,
      },
    });
    expect(dp.value).toBe(34.05); // nightly を skin_temp_c に
    expect(dp.timeSec).toBe(Math.floor(Date.UTC(2026, 5, 2) / 1000));
  });
});

describe('parseReconcileResponse', () => {
  it('実 reconcile 形(dataPointName + 値は直下)', () => {
    // 実機確認: reconcile も値は data ラッパー無しで直下、id=dataPointName
    const { points, cursor } = parseReconcileResponse('weight', {
      dataPoints: [
        {
          dataPointName: 'users/me/.../dp_a',
          weight: { weightGrams: '70000', sampleTime: { physicalTime: '2026-05-30T07:00:00Z' } },
        },
      ],
      nextPageToken: 'tok',
    });
    expect(points).toHaveLength(1);
    expect(points[0]?.id).toBe('users/me/.../dp_a');
    expect(points[0]?.value).toBe(70);
    expect(cursor).toBe('tok');
  });

  it('daily(dataPointName 無し)も読める', () => {
    const { points } = parseReconcileResponse('daily-resting-heart-rate', {
      dataPoints: [
        { dailyRestingHeartRate: { beatsPerMinute: '60', date: { year: 2026, month: 6, day: 1 } } },
      ],
    });
    expect(points[0]?.value).toBe(60);
  });

  it('data ラッパー形(将来差分)も防御的に読める', () => {
    const { points } = parseReconcileResponse('weight', {
      dataPoints: [{ dataPointName: 'dp_b', data: { weight: { weightGrams: '68000' } } }],
    });
    expect(points[0]?.id).toBe('dp_b');
    expect(points[0]?.value).toBe(68);
  });
});

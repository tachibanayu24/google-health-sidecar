import type {
  BodyPushInput,
  ExercisePushInput,
  HealthProvider,
  NutritionPushInput,
  PushResult,
  ReconcileResult,
} from '../HealthProvider';

/**
 * Fitbit Web API 暫定プロバイダ(§5.6/§10.1)。
 * GH 直行が既定だが、移行直後の read 検証/フォールバック用に M3 まで席を確保。
 * Fitbit Web API は 2026-09 停止のため新規 write 経路は実装せず、必要時に既存 MCP 実装から移植する。
 */
export class FitbitProvider implements HealthProvider {
  reconcileDataPoints(): Promise<ReconcileResult> {
    throw new Error(
      'FitbitProvider.reconcileDataPoints: 未実装(M3まで暫定)。既定は GoogleHealthProvider。',
    );
  }
  pushExercise(_input: ExercisePushInput): Promise<PushResult> {
    throw new Error('FitbitProvider.pushExercise: 未実装。');
  }
  pushNutrition(_input: NutritionPushInput): Promise<PushResult> {
    throw new Error('FitbitProvider.pushNutrition: 未実装。');
  }
  pushBodyMetric(_input: BodyPushInput): Promise<PushResult> {
    throw new Error('FitbitProvider.pushBodyMetric: 未実装。');
  }
  batchDelete(): Promise<void> {
    throw new Error('FitbitProvider.batchDelete: 未実装。');
  }
}

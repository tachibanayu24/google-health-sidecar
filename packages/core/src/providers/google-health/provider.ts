import type {
  BodyPushInput,
  ExercisePushInput,
  HealthProvider,
  NutritionPushInput,
  PushResult,
  ReconcileResult,
} from '../HealthProvider';
import { type GetToken, GhClient } from './client';
import { WRITE_DATATYPE } from './discovery-pin';
import {
  buildBodyPayload,
  buildExercisePayload,
  buildNutritionPayload,
  parseCreateResponse,
  parseReconcileResponse,
} from './mappers';

/**
 * Google Health API v4 プロバイダ(§5)。既定の HealthProvider 実装。
 * read response 形は要検証(discovery pin, §5.1)。write payload はこちらが握る。
 */
export class GoogleHealthProvider implements HealthProvider {
  private readonly client: GhClient;
  constructor(getToken: GetToken) {
    this.client = new GhClient(getToken);
  }

  async reconcileDataPoints(
    ghDataType: string,
    filter: string,
    cursor: string | null,
  ): Promise<ReconcileResult> {
    // reconcile = GET + query(discovery doc 確定, §5.1)。filter は呼び出し側が dataType 別に組む。
    const res = await this.client.reconcile(ghDataType, {
      filter,
      pageSize: '25',
      pageToken: cursor ?? undefined,
    });
    return parseReconcileResponse(ghDataType, res);
  }

  async pushExercise(input: ExercisePushInput): Promise<PushResult> {
    const res = await this.client.createDataPoint(
      WRITE_DATATYPE.exercise,
      buildExercisePayload(input),
    );
    return parseCreateResponse(res);
  }

  async pushNutrition(input: NutritionPushInput): Promise<PushResult> {
    const res = await this.client.createDataPoint(
      WRITE_DATATYPE.nutrition,
      buildNutritionPayload(input),
    );
    return parseCreateResponse(res);
  }

  async pushBodyMetric(input: BodyPushInput): Promise<PushResult> {
    const dataType = input.kind === 'weight' ? WRITE_DATATYPE.weight : WRITE_DATATYPE.bodyFat;
    const res = await this.client.createDataPoint(dataType, buildBodyPayload(input));
    return parseCreateResponse(res);
  }

  async batchDelete(ghDataType: string, datapointIds: string[]): Promise<void> {
    if (datapointIds.length === 0) return;
    await this.client.batchDelete(ghDataType, datapointIds);
  }
}

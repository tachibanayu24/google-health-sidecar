/**
 * GH v4 の dataType ID とエンドポイント形状の「pin」(§5.1/§5.4)。
 *
 * ⚠ GH API は actively evolving。reconcile の HTTP verb や一部 dataType ID は
 * M0 で discovery doc(`https://health.googleapis.com/$discovery/rest?version=v4`)
 * を唯一の真実として確定し、ここを更新+契約テストで pin する(§14#4/#7)。
 * 下記は 2026-05-31 時点リファレンス基準の暫定値。
 */

export const GH_BASE = 'https://health.googleapis.com/v4';
export const GH_USER = 'me';

/** reconcile の verb は discovery doc で確定するまで POST 想定(§5.1 要検証)。 */
export const RECONCILE_VERB: 'POST' | 'GET' = 'POST';

/** daily batch 読取の単一マスタ(§5.4)。内部キー=GH dataType ID。 */
export interface ReadDataType {
  /** GH dataType ID(= sync_runs.data_type, loop 反復単位)。 */
  ghDataType: string;
  /** daily_metrics.metric / 専用テーブルへの格納先キー。 */
  store:
    | { kind: 'body_metric'; field: 'weight_kg' | 'body_fat_pct' }
    | { kind: 'sleep' }
    | { kind: 'daily_metric'; metric: string; unit: string };
  /** 要検証(dataType ID をM0 discoveryで確定)なら true で loop から一時除外。 */
  unverified?: boolean;
}

export const READ_DATATYPES: ReadDataType[] = [
  { ghDataType: 'weight', store: { kind: 'body_metric', field: 'weight_kg' } },
  { ghDataType: 'body-fat', store: { kind: 'body_metric', field: 'body_fat_pct' } },
  { ghDataType: 'sleep', store: { kind: 'sleep' } },
  {
    ghDataType: 'daily-resting-heart-rate',
    store: { kind: 'daily_metric', metric: 'resting_hr', unit: 'bpm' },
  },
  {
    ghDataType: 'daily-heart-rate-variability',
    store: { kind: 'daily_metric', metric: 'hrv_rmssd', unit: 'ms' },
  },
  {
    ghDataType: 'daily-oxygen-saturation',
    store: { kind: 'daily_metric', metric: 'spo2_avg', unit: '%' },
  },
  {
    ghDataType: 'daily-vo2-max',
    store: { kind: 'daily_metric', metric: 'vo2max', unit: 'ml/kg/min' },
  },
  {
    ghDataType: 'daily-respiratory-rate',
    store: { kind: 'daily_metric', metric: 'resp_rate', unit: '/min' },
    unverified: true, // dataType ID をM0 discoveryで確定するまで除外
  },
  {
    ghDataType: 'daily-skin-temperature',
    store: { kind: 'daily_metric', metric: 'skin_temp_c', unit: 'celsius' },
    unverified: true,
  },
  { ghDataType: 'steps', store: { kind: 'daily_metric', metric: 'steps', unit: 'count' } },
];

/** 書き込み dataType ID。 */
export const WRITE_DATATYPE = {
  exercise: 'exercise',
  nutrition: 'nutrition-log',
  weight: 'weight',
  bodyFat: 'body-fat',
} as const;

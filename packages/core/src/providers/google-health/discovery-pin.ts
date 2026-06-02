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

/** reconcile は GET(2026-05-31 discovery doc で確定: `dataPoints:reconcile` httpMethod=GET, body無し)。 */
export const RECONCILE_VERB: 'POST' | 'GET' = 'GET';

/**
 * daily batch 読取の単一マスタ(§5.4)。内部キー=GH dataType ID。
 * filter は値オブジェクト名プレフィックス付き(discovery doc 確定):
 *  - sample系: `<valueField>.sample_time.physical_time`(RFC3339)
 *  - interval系: `<valueField>.interval.start_time`(RFC3339)
 *  - daily系: `<valueField>.date`(YYYY-MM-DD)
 *  演算子は `>=` と `<` のみ(`<=` 不可)。
 */
export type TimeShape = 'sample' | 'interval' | 'date';
export interface ReadDataType {
  ghDataType: string;
  /** reconcile の値オブジェクトキー(camelCase)。filter のプレフィックス & data 配下の抽出キー。 */
  valueField: string;
  timeShape: TimeShape;
  /** interval系 filter の時刻フィールド(既定 start_time。sleep は end_time のみ有効=実機確認)。 */
  intervalTimeField?: 'start_time' | 'end_time';
  store:
    | { kind: 'body_metric'; field: 'weight_kg' | 'body_fat_pct' }
    | { kind: 'sleep' }
    | { kind: 'daily_metric'; metric: string; unit: string };
  /** dataType ID が未確定なら true で loop から一時除外。 */
  unverified?: boolean;
}

export const READ_DATATYPES: ReadDataType[] = [
  {
    ghDataType: 'weight',
    valueField: 'weight',
    timeShape: 'sample',
    store: { kind: 'body_metric', field: 'weight_kg' },
  },
  {
    ghDataType: 'body-fat',
    valueField: 'bodyFat',
    timeShape: 'sample',
    store: { kind: 'body_metric', field: 'body_fat_pct' },
  },
  {
    ghDataType: 'sleep',
    valueField: 'sleep',
    timeShape: 'interval',
    intervalTimeField: 'end_time', // sleep は interval.start_time が filter member 不可(実機400)→ end_time
    store: { kind: 'sleep' },
  },
  {
    ghDataType: 'daily-resting-heart-rate',
    valueField: 'dailyRestingHeartRate',
    timeShape: 'date',
    store: { kind: 'daily_metric', metric: 'resting_hr', unit: 'bpm' },
  },
  {
    ghDataType: 'daily-heart-rate-variability',
    valueField: 'dailyHeartRateVariability',
    timeShape: 'date',
    store: { kind: 'daily_metric', metric: 'hrv_rmssd', unit: 'ms' },
  },
  {
    ghDataType: 'daily-oxygen-saturation',
    valueField: 'dailyOxygenSaturation',
    timeShape: 'date',
    store: { kind: 'daily_metric', metric: 'spo2_avg', unit: '%' },
  },
  {
    ghDataType: 'daily-vo2-max',
    valueField: 'dailyVo2Max',
    timeShape: 'date',
    store: { kind: 'daily_metric', metric: 'vo2max', unit: 'ml/kg/min' },
  },
  {
    ghDataType: 'daily-respiratory-rate',
    valueField: 'dailyRespiratoryRate',
    timeShape: 'date',
    store: { kind: 'daily_metric', metric: 'resp_rate', unit: '/min' },
  },
  {
    ghDataType: 'steps',
    valueField: 'steps',
    timeShape: 'interval',
    store: { kind: 'daily_metric', metric: 'steps', unit: 'count' },
    // 実機プローブ(2026-06-01): daily-steps/daily-step-count/step-count は全て Invalid data type ID。
    // 歩数は `steps`(分単位 interval)のみ存在。daily_metric への単一 upsert は最後の1分で上書きされ日次合計に
    // ならず、全分ページングは */5 cron で過負荷(Too many subrequests 実測)。よって当面除外。
    // 日次合計対応は「時刻ゲートで日数回だけ interval を集計し overwrite」する後続実装で復帰予定(§5.4)。
    unverified: true,
  },
  // 皮膚温: 正ID は daily-sleep-temperature-derivations(2026-06-03 discovery doc + 実機確認: 有効・データ有)。
  // 当初 daily-skin-temperature 等の誤ID で probe して Invalid → 恒久除外と誤判定していたのを訂正。
  // 返却 {date, nightlyTemperatureCelsius, baselineTemperatureCelsius, relativeNightlyStddev30dCelsius}。
  // nightly(夜間皮膚温の絶対℃)を skin_temp_c として日次取込。daily 型なので runDailyPull で直接処理。
  {
    ghDataType: 'daily-sleep-temperature-derivations',
    valueField: 'dailySleepTemperatureDerivations',
    timeShape: 'date',
    store: { kind: 'daily_metric', metric: 'skin_temp_c', unit: 'celsius' },
  },
  {
    // 消費カロリー(active)。実機プローブ(2026-06-02): active-energy-burned が有効・分単位 interval の kcal。
    // total-*/daily-*/calories 系は全て Invalid。歩数と同様 runDailyPull では集計せず(unverified で skip)、
    // pullActiveEnergyDaily が時刻ゲートで日次合計して daily_metric(active_energy_kcal) に overwrite。
    ghDataType: 'active-energy-burned',
    valueField: 'activeEnergyBurned',
    timeShape: 'interval',
    store: { kind: 'daily_metric', metric: 'active_energy_kcal', unit: 'kcal' },
    unverified: true,
  },
];

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
function rfc3339(sec: number): string {
  return new Date(sec * 1000).toISOString();
}
function ymd(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

/** dataType 別の time-range filter を組む(discovery doc 文法。演算子 >= と <)。 */
export function buildReadFilter(dt: ReadDataType, sinceSec: number, untilSec: number): string {
  const f = camelToSnake(dt.valueField);
  if (dt.timeShape === 'date') {
    return `${f}.date >= "${ymd(sinceSec)}" AND ${f}.date < "${ymd(untilSec + 86_400)}"`;
  }
  const path =
    dt.timeShape === 'sample'
      ? 'sample_time.physical_time'
      : `interval.${dt.intervalTimeField ?? 'start_time'}`;
  return `${f}.${path} >= "${rfc3339(sinceSec)}" AND ${f}.${path} < "${rfc3339(untilSec)}"`;
}

/** 書き込み dataType ID。 */
export const WRITE_DATATYPE = {
  exercise: 'exercise',
  nutrition: 'nutrition-log',
  weight: 'weight',
  bodyFat: 'body-fat',
} as const;

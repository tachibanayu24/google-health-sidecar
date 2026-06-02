/**
 * Readiness(コンディション信号)の決定的計算 — 純関数のみ(DB/IO/LLM非依存)。
 *
 * 設計の根拠(docs/design.md §Readiness / docs/enhancements.md ④⑤):学術的に確立された
 * 「測定モニタリング手法」であり、予測・処方・診断ツールではない。出すのは
 * 「あなた自身の過去データに対する相対的な逸脱の事実」まで。
 *
 *  - 中核 = 夜間 HRV(rMSSD)。単日はノイズ過大なため ln 変換 → 7日ローリング平均を当日代表値に
 *    (Plews & Buchheit 2013/2014)。これを省くと「適当な計算」になる。
 *  - 個人ベースライン = 代表値系列の中央値 ± MAD による頑健統計。robust z = (x−median)/(1.4826·MAD)
 *    は SD 単位(Iglewicz & Hoaglin 1993)。平均±SD は小標本/外れ値で膨張するため使わない。
 *  - 統合は偽の 0–100 合成スコアを作らない。各指標を個別に信号化し、N-of-M(2指標以上が同時に
 *    悪方向へ逸脱)で全体を赤に(Apple Vitals と同型)。HRV(中核)単独の赤は全体赤へ昇格。
 *  - 学習期間中・データ不足は判定を出さず「あとN日」と正直に出す。
 */

export type ReadinessSignal = 'green' | 'yellow' | 'red';
export type ContributorStatus = 'ready' | 'learning' | 'no-data';

/** 入力: 指標ごとの昇順時系列(欠測日は含めない)。endDate までの値を渡す。 */
export interface MetricPoint {
  date: string;
  value: number;
}

export interface ReadinessInput {
  date: string;
  /** metric キー → 昇順 [{date,value}]。sleep_total_min / sleep_efficiency は疑似 metric として渡す。 */
  series: Record<string, MetricPoint[]>;
}

export interface Contributor {
  metric: string;
  label: string;
  unit: string;
  isCore: boolean;
  status: ContributorStatus;
  daysOfData: number;
  /** 当日代表値(HRV は直近7日の幾何平均 ms)。元単位。 */
  current: number | null;
  baselineMedian: number | null;
  normalLow: number | null;
  normalHigh: number | null;
  deviation: 'low' | 'normal' | 'high' | null;
  signal: ReadinessSignal | null;
}

export interface Readiness {
  date: string;
  overall: {
    signal: ReadinessSignal | null;
    status: 'ready' | 'learning';
    /** 悪方向へ逸脱している指標数(N-of-M の N)。 */
    deviating: number;
    evaluated: number;
    summary: string;
    learningRemainingDays: number;
  };
  contributors: Contributor[];
  disclaimer: string;
}

type ThresholdMode = 'sd' | 'abs';
interface MetricConfig {
  metric: string;
  label: string;
  unit: string;
  isCore: boolean;
  /** 悪い方向。HRV/睡眠は low が悪い、RHR/呼吸/皮膚温は high が悪い。 */
  badDir: 'low' | 'high';
  transform?: 'ln';
  /** HRV のみ: 当日代表値=直近N日ローリング平均(最低 minWindowValid 日)。 */
  rollingDays?: number;
  minWindowValid?: number;
  mode: ThresholdMode;
  /** mode='sd': SD単位の閾値。mode='abs': 元単位での中央値からの偏差閾値。 */
  yellow: number;
  red: number;
  /** MAD の下限(退化=過敏化を防ぐ)。算出スケール(ln指標は ln スケール)での値。 */
  madFloor: number;
  round: number;
}

// 各指標の手法・閾値。閾値は文献慣習に基づく工学的選択で、運用しながら誤検知率を見て調整する前提。
const CONFIG: MetricConfig[] = [
  {
    metric: 'hrv_rmssd',
    label: 'HRV',
    unit: 'ms',
    isCore: true,
    badDir: 'low',
    transform: 'ln',
    rollingDays: 7,
    minWindowValid: 4,
    mode: 'sd',
    yellow: 1,
    red: 2,
    madFloor: 0.04, // ln スケール(≈ rMSSD 4%)
    round: 0,
  },
  {
    metric: 'resting_hr',
    label: '安静時心拍',
    unit: 'bpm',
    isCore: false,
    badDir: 'high',
    mode: 'sd',
    yellow: 1.5,
    red: 2.5,
    madFloor: 1,
    round: 0,
  },
  {
    // 呼吸数のみ査読由来の絶対閾値が転用可(Natarajan/Heneghan 2021): +3=黄, +5=赤。
    metric: 'resp_rate',
    label: '呼吸数',
    unit: '/min',
    isCore: false,
    badDir: 'high',
    mode: 'abs',
    yellow: 3,
    red: 5,
    madFloor: 0.5,
    round: 1,
  },
  {
    metric: 'skin_temp_c',
    label: '皮膚温',
    unit: '℃',
    isCore: false,
    badDir: 'high',
    mode: 'sd',
    yellow: 2,
    red: 3,
    madFloor: 0.05, // ℃(MAD=0 退化対策の下限)
    round: 2,
  },
  {
    metric: 'sleep_total_min',
    label: '睡眠時間',
    unit: '分',
    isCore: false,
    badDir: 'low',
    mode: 'sd',
    yellow: 1,
    red: 2,
    madFloor: 10,
    round: 0,
  },
  {
    metric: 'sleep_efficiency',
    label: '睡眠効率',
    unit: '%',
    isCore: false,
    badDir: 'low',
    mode: 'sd',
    yellow: 1.5,
    red: 2.5,
    madFloor: 1,
    round: 0,
  },
];

/** ベースライン確立の最小日数。文献は28日が頑健(一部14–28)。やや保守的に14で開始し、増えるほど鋭くなる。 */
export const LEARNING_MIN_DAYS = 14;
/** ベースライン窓の上限(古すぎる平常を持ち越さずドリフト追従)。 */
const BASELINE_MAX_DAYS = 60;
const MAD_TO_SD = 1.4826; // 正規分布で MAD→SD 換算

export function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Median Absolute Deviation(中央値からの絶対偏差の中央値)。 */
export function mad(xs: number[], med = median(xs)): number {
  if (xs.length === 0) return Number.NaN;
  return median(xs.map((x) => Math.abs(x - med)));
}

/** 末尾 windowDays の移動平均系列(各窓に minValid 件以上ある点のみ出力)。 */
function rollingMean(points: MetricPoint[], windowDays: number, minValid: number): MetricPoint[] {
  const out: MetricPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const win = points.slice(Math.max(0, i - windowDays + 1), i + 1);
    if (win.length < minValid) continue;
    const mean = win.reduce((a, p) => a + p.value, 0) / win.length;
    out.push({ date: points[i]!.date, value: mean });
  }
  return out;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function emptyContributor(cfg: MetricConfig, status: ContributorStatus, days: number): Contributor {
  return {
    metric: cfg.metric,
    label: cfg.label,
    unit: cfg.unit,
    isCore: cfg.isCore,
    status,
    daysOfData: days,
    current: null,
    baselineMedian: null,
    normalLow: null,
    normalHigh: null,
    deviation: null,
    signal: null,
  };
}

function computeContributor(cfg: MetricConfig, raw: MetricPoint[]): Contributor {
  // 1) 変換(HRV は ln。value<=0 は除外)。
  let pts: MetricPoint[] = raw
    .map((p) => ({ date: p.date, value: cfg.transform === 'ln' ? Math.log(p.value) : p.value }))
    .filter((p) => Number.isFinite(p.value));
  // 2) HRV は ln の7日ローリング平均を代表値系列に(単日ノイズの平滑化)。
  if (cfg.rollingDays) pts = rollingMean(pts, cfg.rollingDays, cfg.minWindowValid ?? 1);
  if (pts.length === 0) return emptyContributor(cfg, 'no-data', 0);

  const currentT = pts[pts.length - 1]!.value; // 当日代表値(変換スケール)
  // 3) ベースライン = 当日を除く直近 BASELINE_MAX_DAYS の代表値。
  const pool = pts
    .slice(0, -1)
    .slice(-BASELINE_MAX_DAYS)
    .map((p) => p.value);
  const daysOfData = pool.length;
  const inv = (v: number) => (cfg.transform === 'ln' ? Math.exp(v) : v); // 表示用に逆変換
  if (daysOfData < LEARNING_MIN_DAYS) {
    const c = emptyContributor(cfg, 'learning', daysOfData);
    c.current = round(inv(currentT), cfg.round);
    return c;
  }

  // 4) 頑健統計(中央値 ± MAD)。MAD は下限で退化(過敏化)を防ぐ。
  const med = median(pool);
  const madEff = Math.max(mad(pool, med), cfg.madFloor);
  const sd = MAD_TO_SD * madEff;
  const normalLowT = med - sd;
  const normalHighT = med + sd;

  // 5) 信号判定(悪方向の逸脱のみ警告。良方向は緑)。
  let signal: ReadinessSignal = 'green';
  const devSigned = cfg.mode === 'sd' ? (currentT - med) / sd : currentT - med; // SD単位 or 元単位偏差
  const badMag = cfg.badDir === 'low' ? -devSigned : devSigned; // 悪方向の大きさ(正なら悪化)
  if (badMag >= cfg.red) signal = 'red';
  else if (badMag >= cfg.yellow) signal = 'yellow';

  const deviation: Contributor['deviation'] =
    currentT < normalLowT ? 'low' : currentT > normalHighT ? 'high' : 'normal';

  return {
    metric: cfg.metric,
    label: cfg.label,
    unit: cfg.unit,
    isCore: cfg.isCore,
    status: 'ready',
    daysOfData,
    current: round(inv(currentT), cfg.round),
    baselineMedian: round(inv(med), cfg.round),
    normalLow: round(inv(normalLowT), cfg.round),
    normalHigh: round(inv(normalHighT), cfg.round),
    deviation,
    signal,
  };
}

const DISCLAIMER =
  'これは医学的診断・パフォーマンス予測ではなく、あなた自身の過去データに対する相対的な逸脱の提示です。値は消費者デバイスの推定のため、絶対精度ではなく「自分比のトレンド」として解釈してください。';

/** Readiness を決定的に計算。series は metric→昇順[{date,value}]。 */
export function computeReadiness(input: ReadinessInput): Readiness {
  const contributors = CONFIG.map((cfg) => computeContributor(cfg, input.series[cfg.metric] ?? []));

  const ready = contributors.filter((c) => c.status === 'ready');
  const learning = contributors.filter((c) => c.status === 'learning');
  // 学習残日数 = 学習中で最もデータが揃っている指標が確立するまで。
  const learningRemainingDays = learning.length
    ? Math.max(0, LEARNING_MIN_DAYS - Math.max(...learning.map((c) => c.daysOfData)))
    : 0;

  // N-of-M で統合(合成スコアは作らない)。評価可能が2指標未満なら判定保留。
  if (ready.length < 2) {
    return {
      date: input.date,
      overall: {
        signal: null,
        status: 'learning',
        deviating: 0,
        evaluated: ready.length,
        summary:
          learningRemainingDays > 0
            ? `学習中 — ベースライン確立まであと約${learningRemainingDays}日`
            : 'データ不足で判定できません',
        learningRemainingDays,
      },
      contributors,
      disclaimer: DISCLAIMER,
    };
  }

  const bad = ready.filter((c) => c.signal === 'yellow' || c.signal === 'red');
  const hrvRed = ready.some((c) => c.isCore && c.signal === 'red');
  // HRV(中核)単独赤 or 2指標以上同時逸脱 → 全体赤。単独の逸脱は黄(単一指標で赤に昇格させない)。
  const signal: ReadinessSignal =
    hrvRed || bad.length >= 2 ? 'red' : bad.length >= 1 ? 'yellow' : 'green';

  const badLabels = bad.map((c) => c.label).join('・');
  const summary =
    signal === 'green'
      ? 'あなたの平常範囲内です'
      : signal === 'red'
        ? `${badLabels} が平常から大きく/複数同時に外れています`
        : `${badLabels} が平常範囲から外れています`;

  return {
    date: input.date,
    overall: {
      signal,
      status: 'ready',
      deviating: bad.length,
      evaluated: ready.length,
      summary,
      learningRemainingDays,
    },
    contributors,
    disclaimer: DISCLAIMER,
  };
}

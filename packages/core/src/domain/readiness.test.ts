import { describe, expect, it } from 'vitest';
import { computeReadiness, type MetricPoint, mad, median } from './readiness';

// 連番日付の時系列を作る(計算は配列順=昇順日次を前提。日付はラベル)。
function ser(values: number[]): MetricPoint[] {
  const base = Date.parse('2026-01-01T00:00:00Z');
  return values.map((v, i) => ({
    date: new Date(base + i * 86400_000).toISOString().slice(0, 10),
    value: v,
  }));
}
const flat = (v: number, n: number): number[] => Array(n).fill(v);
const get = (r: ReturnType<typeof computeReadiness>, m: string) =>
  r.contributors.find((c) => c.metric === m)!;

describe('median / mad', () => {
  it('median 偶数/奇数', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
  });
  it('mad は中央値からの絶対偏差の中央値', () => {
    expect(mad([1, 2, 3, 4, 5])).toBe(1);
  });
});

describe('computeReadiness — 学習ゲート', () => {
  it('データ不足は判定せず learning + あとN日', () => {
    const r = computeReadiness({
      date: '2026-02-10',
      series: { hrv_rmssd: ser(flat(50, 10)), resting_hr: ser(flat(55, 10)) },
    });
    expect(r.overall.status).toBe('learning');
    expect(r.overall.signal).toBeNull();
    expect(r.overall.learningRemainingDays).toBeGreaterThan(0);
    expect(get(r, 'hrv_rmssd').status).toBe('learning');
  });

  it('series に無い指標は no-data(全体評価から除外)', () => {
    const r = computeReadiness({
      date: '2026-02-10',
      series: { hrv_rmssd: ser(flat(50, 40)), resting_hr: ser(flat(55, 41)) },
    });
    expect(get(r, 'skin_temp_c').status).toBe('no-data');
    expect(get(r, 'skin_temp_c').current).toBeNull();
  });
});

describe('computeReadiness — 信号方向', () => {
  it('平常どおりなら緑', () => {
    const r = computeReadiness({
      date: '2026-02-10',
      series: { hrv_rmssd: ser(flat(50, 40)), resting_hr: ser(flat(55, 41)) },
    });
    expect(r.overall.status).toBe('ready');
    expect(r.overall.signal).toBe('green');
    expect(get(r, 'hrv_rmssd').signal).toBe('green');
  });

  it('HRV(中核)が大きく低下 → 当該赤 + 全体赤', () => {
    const r = computeReadiness({
      date: '2026-02-10',
      series: {
        hrv_rmssd: ser([...flat(50, 33), ...flat(25, 7)]), // 直近7日で半減
        resting_hr: ser(flat(55, 41)),
      },
    });
    expect(get(r, 'hrv_rmssd').signal).toBe('red');
    expect(get(r, 'hrv_rmssd').deviation).toBe('low');
    expect(r.overall.signal).toBe('red');
  });

  it('良い方向(HRV上昇)は警告しない=緑', () => {
    const r = computeReadiness({
      date: '2026-02-10',
      series: {
        hrv_rmssd: ser([...flat(50, 33), ...flat(100, 7)]),
        resting_hr: ser(flat(55, 41)),
      },
    });
    expect(get(r, 'hrv_rmssd').signal).toBe('green');
    expect(r.overall.signal).toBe('green');
  });
});

describe('computeReadiness — 呼吸数の絶対閾値(Natarajan/Heneghan)', () => {
  const baseline = { hrv_rmssd: ser(flat(50, 40)), resting_hr: ser(flat(55, 41)) };
  it('+3/min で黄', () => {
    const r = computeReadiness({
      date: '2026-02-10',
      series: { ...baseline, resp_rate: ser([...flat(14, 40), 17]) },
    });
    expect(get(r, 'resp_rate').signal).toBe('yellow');
  });
  it('+5/min で赤', () => {
    const r = computeReadiness({
      date: '2026-02-10',
      series: { ...baseline, resp_rate: ser([...flat(14, 40), 19]) },
    });
    expect(get(r, 'resp_rate').signal).toBe('red');
  });
  it('+2/min は緑', () => {
    const r = computeReadiness({
      date: '2026-02-10',
      series: { ...baseline, resp_rate: ser([...flat(14, 40), 16]) },
    });
    expect(get(r, 'resp_rate').signal).toBe('green');
  });
});

describe('computeReadiness — N-of-M 統合(合成スコアを作らない)', () => {
  it('単一指標の逸脱は全体=黄(単独で赤に昇格しない)', () => {
    const r = computeReadiness({
      date: '2026-02-10',
      series: {
        hrv_rmssd: ser(flat(50, 40)),
        resting_hr: ser(flat(55, 41)),
        resp_rate: ser([...flat(14, 40), 17]), // 黄1つだけ
      },
    });
    expect(r.overall.signal).toBe('yellow');
    expect(r.overall.deviating).toBe(1);
  });

  it('非中核2指標が同時逸脱 → 全体赤(N-of-M=2)', () => {
    const r = computeReadiness({
      date: '2026-02-10',
      series: {
        hrv_rmssd: ser(flat(50, 40)), // 中核は正常
        resting_hr: ser([...flat(55, 40), 70]), // 大きく上昇=赤方向
        resp_rate: ser([...flat(14, 40), 17]), // +3=黄
      },
    });
    expect(r.overall.signal).toBe('red');
    expect(r.overall.deviating).toBe(2);
  });
});

import { computeReadiness, type MetricPoint, type Readiness } from '../../domain/readiness';
import { assertIsoDate, todayJst, toJstDateString } from '../../util/date';
import type { Db } from '../client';

// ベースライン窓(60日)+ HRV ローリング(7日)に十分な余裕を持って取得。
const FETCH_DAYS = 75;
const SENSING_METRICS = ['hrv_rmssd', 'resting_hr', 'resp_rate', 'skin_temp_c'] as const;

/**
 * Readiness を D1 実測から計算(§Readiness)。daily_metrics(HRV/RHR/呼吸/皮膚温)+ sleep_logs
 * (主睡眠の総時間・効率)の時系列を集めて純関数 computeReadiness に渡すだけ(集計の真実はここに集約)。
 * read 専用・§8.5 write 経路に無関係。get_readiness MCP と /api/readiness が共有。
 */
export async function getReadiness(db: Db, date?: string): Promise<Readiness> {
  const end = date ?? todayJst();
  assertIsoDate(end, 'date');
  const since = toJstDateString(Date.parse(`${end}T00:00:00+09:00`) - FETCH_DAYS * 86400_000);

  const sensing = await db.raw<{ date: string; metric: string; value: number }>(
    `SELECT date, metric, value FROM daily_metrics
      WHERE metric IN (${SENSING_METRICS.map(() => '?').join(',')})
        AND date >= ? AND date <= ?
      ORDER BY date ASC`,
    ...SENSING_METRICS,
    since,
    end,
  );
  // 主睡眠(その日の最長)= getSleepByDate / weekly と同じ規約。
  const sleep = await db.raw<{ date: string; total_min: number; efficiency: number | null }>(
    `SELECT date, total_min, efficiency FROM sleep_logs s
      WHERE date >= ? AND date <= ?
        AND s.total_min = (SELECT MAX(s2.total_min) FROM sleep_logs s2 WHERE s2.date = s.date)
      ORDER BY date ASC`,
    since,
    end,
  );

  const series: Record<string, MetricPoint[]> = {};
  for (const m of SENSING_METRICS) series[m] = [];
  series.sleep_total_min = [];
  series.sleep_efficiency = [];
  for (const r of sensing) series[r.metric]?.push({ date: r.date, value: r.value });
  for (const r of sleep) {
    series.sleep_total_min!.push({ date: r.date, value: r.total_min });
    if (r.efficiency != null) series.sleep_efficiency!.push({ date: r.date, value: r.efficiency });
  }

  return computeReadiness({ date: end, series });
}

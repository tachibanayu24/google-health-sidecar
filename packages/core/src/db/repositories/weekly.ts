import type { Db } from '../client';

/**
 * 週間サマリー集計(直近7日)。トレ/食事/睡眠/コンディション/体重を一括集計(画像エクスポート用)。
 * すべて D1 正本(体重・睡眠・センシングは GH ミラーを含む)。範囲は呼び出し側が start/end(JST日付)と
 * startSec/endSec(epoch秒, PR 達成時刻の突合用)で与える。
 */
export interface WeeklySummary {
  range: { start: string; end: string };
  training: { sessions: number; volumeKg: number; prs: number };
  nutrition: {
    daysLogged: number;
    avgKcal: number;
    avgP: number;
    avgF: number;
    avgC: number;
    avgSodiumMg: number;
    avgFiberG: number;
  };
  sleep: { nights: number; avgTotalMin: number | null; avgEfficiency: number | null };
  sensing: {
    avgSteps: number | null;
    avgActiveKcal: number | null;
    avgRestingHr: number | null;
    avgHrv: number | null;
  };
  body: { startKg: number | null; endKg: number | null; deltaKg: number | null };
}

export async function getWeeklySummary(
  db: Db,
  start: string,
  end: string,
  startSec: number,
  endSec: number,
): Promise<WeeklySummary> {
  const [tr] = await db.raw<{ sessions: number; volume: number }>(
    `SELECT COUNT(*) AS sessions, COALESCE(ROUND(SUM(total_volume_kg)), 0) AS volume
       FROM workout_sessions WHERE status='completed' AND date BETWEEN ? AND ?`,
    start,
    end,
  );
  const [pr] = await db.raw<{ prs: number }>(
    `SELECT COUNT(*) AS prs FROM personal_records
      WHERE record_type='e1rm' AND achieved_at BETWEEN ? AND ?`,
    startSec,
    endSec,
  );
  const [nut] = await db.raw<{
    days: number;
    kcal: number;
    p: number;
    f: number;
    c: number;
    sodium: number;
    fiber: number;
  }>(
    `SELECT COUNT(DISTINCT m.date) AS days,
            COALESCE(SUM(mi.calories_kcal), 0) AS kcal, COALESCE(SUM(mi.protein_g), 0) AS p,
            COALESCE(SUM(mi.fat_g), 0) AS f, COALESCE(SUM(mi.carbs_g), 0) AS c,
            COALESCE(SUM(mi.sodium_mg), 0) AS sodium, COALESCE(SUM(mi.fiber_g), 0) AS fiber
       FROM meals m JOIN meal_items mi ON mi.meal_id = m.id
      WHERE m.date BETWEEN ? AND ?`,
    start,
    end,
  );
  // 睡眠は getSleepByDate と同じく「日ごとの最長=主睡眠」を1晩とみなして平均(仮眠/分割で過小評価しない)。
  const [sl] = await db.raw<{ nights: number; avg_total: number | null; avg_eff: number | null }>(
    `SELECT COUNT(*) AS nights, ROUND(AVG(total_min)) AS avg_total, ROUND(AVG(efficiency)) AS avg_eff
       FROM sleep_logs s
      WHERE s.date BETWEEN ? AND ?
        AND s.total_min = (SELECT MAX(s2.total_min) FROM sleep_logs s2 WHERE s2.date = s.date)`,
    start,
    end,
  );
  const sensingRows = await db.raw<{ metric: string; avg: number }>(
    `SELECT metric, AVG(value) AS avg FROM daily_metrics WHERE date BETWEEN ? AND ? GROUP BY metric`,
    start,
    end,
  );
  const sens = new Map(sensingRows.map((r) => [r.metric, r.avg]));
  const weights = await db.raw<{ weight_kg: number }>(
    `SELECT weight_kg FROM body_metrics
      WHERE weight_kg IS NOT NULL AND date BETWEEN ? AND ? ORDER BY measured_at ASC`,
    start,
    end,
  );

  const days = nut?.days ?? 0;
  const avg = (v: number) => (days > 0 ? Math.round(v / days) : 0);
  const r0 = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  const startKg = weights[0]?.weight_kg ?? null;
  const endKg = weights.length ? (weights[weights.length - 1]?.weight_kg ?? null) : null;

  return {
    range: { start, end },
    training: { sessions: tr?.sessions ?? 0, volumeKg: tr?.volume ?? 0, prs: pr?.prs ?? 0 },
    nutrition: {
      daysLogged: days,
      avgKcal: avg(nut?.kcal ?? 0),
      avgP: avg(nut?.p ?? 0),
      avgF: avg(nut?.f ?? 0),
      avgC: avg(nut?.c ?? 0),
      avgSodiumMg: avg(nut?.sodium ?? 0),
      avgFiberG: days > 0 ? Math.round(((nut?.fiber ?? 0) / days) * 10) / 10 : 0,
    },
    sleep: {
      nights: sl?.nights ?? 0,
      avgTotalMin: r0(sl?.avg_total),
      avgEfficiency: r0(sl?.avg_eff),
    },
    sensing: {
      avgSteps: r0(sens.get('steps')),
      avgActiveKcal: r0(sens.get('active_energy_kcal')),
      avgRestingHr: r0(sens.get('resting_hr')),
      avgHrv: r0(sens.get('hrv_rmssd')),
    },
    body: {
      startKg,
      endKg,
      deltaKg: startKg != null && endKg != null ? Math.round((endKg - startKg) * 10) / 10 : null,
    },
  };
}

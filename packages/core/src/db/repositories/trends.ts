import type { Db } from '../client';

/**
 * トレンド集計(History 画面 / §8.6)。すべて D1 正本(体重は GH ミラー含む)。
 */

export interface BodyPoint {
  date: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
}
export interface VolumePoint {
  date: string;
  volume_kg: number;
}
export interface PfcPoint {
  date: string;
  kcal: number;
  p: number;
  f: number;
  c: number;
}
export interface Trends {
  body: BodyPoint[];
  volumeDaily: VolumePoint[];
  pfcDaily: PfcPoint[];
}

export async function getTrends(db: Db, sinceDate: string): Promise<Trends> {
  // 体重: 日ごとに最新測定(measured_at 最大)を1点。
  const body = await db.raw<BodyPoint>(
    `SELECT bm.date AS date, bm.weight_kg AS weight_kg, bm.body_fat_pct AS body_fat_pct
       FROM body_metrics bm
      WHERE bm.weight_kg IS NOT NULL AND bm.date >= ?
        AND bm.measured_at = (
          SELECT max(b2.measured_at) FROM body_metrics b2
           WHERE b2.date = bm.date AND b2.weight_kg IS NOT NULL)
      ORDER BY bm.date`,
    sinceDate,
  );

  const volumeDaily = await db.raw<VolumePoint>(
    `SELECT date, ROUND(SUM(total_volume_kg)) AS volume_kg
       FROM workout_sessions
      WHERE date >= ? AND status = 'completed'
      GROUP BY date ORDER BY date`,
    sinceDate,
  );

  const pfcDaily = await db.raw<PfcPoint>(
    `SELECT m.date AS date,
            ROUND(SUM(mi.calories_kcal)) AS kcal,
            ROUND(SUM(mi.protein_g)) AS p,
            ROUND(SUM(mi.fat_g)) AS f,
            ROUND(SUM(mi.carbs_g)) AS c
       FROM meals m JOIN meal_items mi ON mi.meal_id = m.id
      WHERE m.date >= ?
      GROUP BY m.date ORDER BY m.date`,
    sinceDate,
  );

  return { body, volumeDaily, pfcDaily };
}

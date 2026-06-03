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
  // 体重・体脂肪: 日ごとに各最新測定を1点。weight と body_fat は別行で格納されるため独立に取る
  // (getBodyForDate と同規約)。どちらか一方しか無い日も含める。
  const body = await db.raw<BodyPoint>(
    `SELECT d.date AS date,
            (SELECT w.weight_kg FROM body_metrics w
              WHERE w.date = d.date AND w.weight_kg IS NOT NULL
              ORDER BY w.measured_at DESC LIMIT 1) AS weight_kg,
            (SELECT f.body_fat_pct FROM body_metrics f
              WHERE f.date = d.date AND f.body_fat_pct IS NOT NULL AND f.body_fat_pct > 0
              ORDER BY f.measured_at DESC LIMIT 1) AS body_fat_pct
       FROM (SELECT DISTINCT date FROM body_metrics
              WHERE date >= ? AND (weight_kg IS NOT NULL OR (body_fat_pct IS NOT NULL AND body_fat_pct > 0))) d
      ORDER BY d.date`,
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

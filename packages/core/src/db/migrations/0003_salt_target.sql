-- 食塩相当量の目標(<6g/日)。GH には sodium(mg)で保存、表示は食塩相当量(g)に換算(§9.4)。
-- 食塩相当量(g) = ナトリウム(mg) × 2.54 / 1000。
ALTER TABLE nutrition_targets ADD COLUMN target_salt_g REAL NOT NULL DEFAULT 6;

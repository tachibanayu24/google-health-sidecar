-- ボリュームランドマーク(MEV/MAV/MRV)を muscle_groups に追加(design.md §8.9 / enhancements.md ⑧)。
-- 出典: Renaissance Periodization / Israetel の Training Volume Landmarks(週間ハードセット数)。
-- 注意: これは「研究情報に基づくガイドラインの帯・個人差ありの出発点」であって、精密に検証された
-- 個人別閾値ではない(用量反応そのものは Schoenfeld 2017 / Pelland 2024 等のメタ解析で支持)。
-- mev=最低有効量 / mav_low..mav_high=最大適応量(伸びやすい sweet spot)/ mrv=最大回復可能量。
-- RP が明確な肥大ランドマークを示さない部位(obliques / lower_back)は NULL(=ガイドラインなし)。

ALTER TABLE muscle_groups ADD COLUMN mev_sets INTEGER;
ALTER TABLE muscle_groups ADD COLUMN mav_low_sets INTEGER;
ALTER TABLE muscle_groups ADD COLUMN mav_high_sets INTEGER;
ALTER TABLE muscle_groups ADD COLUMN mrv_sets INTEGER;

UPDATE muscle_groups SET mev_sets=8,  mav_low_sets=12, mav_high_sets=20, mrv_sets=22 WHERE id='chest';
UPDATE muscle_groups SET mev_sets=10, mav_low_sets=14, mav_high_sets=22, mrv_sets=25 WHERE id='lats';
UPDATE muscle_groups SET mev_sets=4,  mav_low_sets=12, mav_high_sets=20, mrv_sets=26 WHERE id='traps';
UPDATE muscle_groups SET mev_sets=6,  mav_low_sets=8,  mav_high_sets=12, mrv_sets=16 WHERE id='front_delts';
UPDATE muscle_groups SET mev_sets=8,  mav_low_sets=16, mav_high_sets=22, mrv_sets=26 WHERE id='side_delts';
UPDATE muscle_groups SET mev_sets=6,  mav_low_sets=10, mav_high_sets=18, mrv_sets=24 WHERE id='rear_delts';
UPDATE muscle_groups SET mev_sets=8,  mav_low_sets=14, mav_high_sets=20, mrv_sets=26 WHERE id='biceps';
UPDATE muscle_groups SET mev_sets=6,  mav_low_sets=10, mav_high_sets=14, mrv_sets=18 WHERE id='triceps';
UPDATE muscle_groups SET mev_sets=2,  mav_low_sets=8,  mav_high_sets=12, mrv_sets=16 WHERE id='forearms';
UPDATE muscle_groups SET mev_sets=6,  mav_low_sets=16, mav_high_sets=20, mrv_sets=25 WHERE id='abs';
UPDATE muscle_groups SET mev_sets=8,  mav_low_sets=12, mav_high_sets=18, mrv_sets=20 WHERE id='quads';
UPDATE muscle_groups SET mev_sets=4,  mav_low_sets=10, mav_high_sets=16, mrv_sets=20 WHERE id='hamstrings';
UPDATE muscle_groups SET mev_sets=4,  mav_low_sets=8,  mav_high_sets=12, mrv_sets=16 WHERE id='glutes';
UPDATE muscle_groups SET mev_sets=8,  mav_low_sets=12, mav_high_sets=16, mrv_sets=20 WHERE id='calves';

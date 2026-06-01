-- 食物繊維の目標(既定 20g/日)。P/F/C/食塩 と同じ栄養素レーダーで「対目標%」を出すため。
-- 既存の食事(fiber_g 未捕捉)は 0 表示になる前提。今後の手入力/MCP 記録で蓄積される。
ALTER TABLE nutrition_targets ADD COLUMN target_fiber_g REAL NOT NULL DEFAULT 20;

-- 0006: GH の食事(nutrition-log)を取り込めるよう meals を拡張(§5.2 双方向化)。
-- source=google_health で取込分を区別、gh_external_id で重複取込を防止(own-write echo は別途 gh_sync_state 判定)。
ALTER TABLE meals ADD COLUMN source TEXT NOT NULL DEFAULT 'app';
ALTER TABLE meals ADD COLUMN gh_external_id TEXT;
CREATE UNIQUE INDEX idx_meals_gh ON meals(gh_external_id) WHERE gh_external_id IS NOT NULL;

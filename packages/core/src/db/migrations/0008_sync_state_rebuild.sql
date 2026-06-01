-- gh_sync_state の CHECK 制約を緩和するためのテーブル再構築(SQLite は CHECK を ALTER 不可)。
--  1) sync_status に 'dead_letter' を追加(0007 で code/enum は対応済だが CHECK 未更新だった)
--  2) entity_type に 'body_metric_fat' を追加(体脂肪 datapoint を体重と独立に追跡・再試行・echo判定)
-- 既存列(next_retry_at 含む)とデータはそのまま移送。FK 参照は無いので drop/rename 安全。
CREATE TABLE gh_sync_state_new (
  entity_type      TEXT NOT NULL CHECK (entity_type IN ('workout','meal','body_metric','body_metric_fat')),
  entity_id        TEXT NOT NULL,
  gh_datapoint_id  TEXT,
  gh_data_origin   TEXT,
  sync_status      TEXT NOT NULL DEFAULT 'pending'
                     CHECK (sync_status IN ('pending','synced','failed','dead_letter','stale','deleted_remote','skipped_flag_off')),
  last_pushed_hash TEXT,
  last_pushed_at   INTEGER,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  next_retry_at    INTEGER,
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (entity_type, entity_id)
);

INSERT INTO gh_sync_state_new
  (entity_type, entity_id, gh_datapoint_id, gh_data_origin, sync_status,
   last_pushed_hash, last_pushed_at, retry_count, last_error, next_retry_at, updated_at)
  SELECT entity_type, entity_id, gh_datapoint_id, gh_data_origin, sync_status,
         last_pushed_hash, last_pushed_at, retry_count, last_error, next_retry_at, updated_at
    FROM gh_sync_state;

DROP TABLE gh_sync_state;
ALTER TABLE gh_sync_state_new RENAME TO gh_sync_state;

CREATE INDEX idx_gh_sync_status ON gh_sync_state(sync_status);
CREATE INDEX idx_gh_sync_retry ON gh_sync_state(sync_status, next_retry_at);

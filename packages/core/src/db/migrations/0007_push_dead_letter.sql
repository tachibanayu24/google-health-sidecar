-- §12.2 push の dead-letter 化: バックオフ時刻と恒久失敗の隔離。
-- next_retry_at: NULL なら即時対象。値があればその時刻まで再試行を見送る(指数バックオフ)。
ALTER TABLE gh_sync_state ADD COLUMN next_retry_at INTEGER;

-- pending/failed のうち再試行可能なものだけを updated_at 順に拾うためのインデックス。
CREATE INDEX IF NOT EXISTS idx_gh_sync_retry
  ON gh_sync_state (sync_status, next_retry_at);

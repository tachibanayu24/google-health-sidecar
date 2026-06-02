-- 0014: daily_metrics の metric CHECK に active_energy_kcal を追加(消費カロリー取込・エネルギー収支)。
--  SQLite は CHECK 制約を ALTER で変更できないため table 再構築(FK は無いので copy→drop→rename で安全)。
CREATE TABLE daily_metrics_new (
  date           TEXT NOT NULL,
  metric         TEXT NOT NULL
                   CHECK (metric IN ('spo2_avg','resp_rate','hrv_rmssd','skin_temp_c','resting_hr','vo2max','steps','active_energy_kcal')),
  value          REAL NOT NULL,
  unit           TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'google_health' CHECK (source IN ('google_health','app')),
  gh_external_id TEXT,
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (date, metric)
);
INSERT INTO daily_metrics_new (date, metric, value, unit, source, gh_external_id, updated_at)
  SELECT date, metric, value, unit, source, gh_external_id, updated_at FROM daily_metrics;
DROP TABLE daily_metrics;
ALTER TABLE daily_metrics_new RENAME TO daily_metrics;

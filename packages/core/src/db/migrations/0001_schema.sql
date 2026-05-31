-- google-health-sidecar 初期スキーマ(設計書 §7, v3監査反映版)
-- 方針: 重さは入力生値+単位を正本、集計は load_kg(kg)で正規化。
--       GH由来行は gh_external_id をユニークキーに冪等upsert。
--       FK は DML 時のみ強制(SQLite)。親テーブルを子より前に定義して適用順非依存に。
--       多表書込み・編集は単一 db.batch() に収める(§8.5)。

-- ============ アプリ設定(単一行) ============
CREATE TABLE settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  unit_preference TEXT NOT NULL DEFAULT 'kg' CHECK (unit_preference IN ('kg','lb')),
  e1rm_formula    TEXT NOT NULL DEFAULT 'epley' CHECK (e1rm_formula IN ('epley','brzycki')),
  locale          TEXT NOT NULL DEFAULT 'ja',
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ 栄養目標(フェーズ履歴) ============
CREATE TABLE nutrition_targets (
  id               TEXT PRIMARY KEY,
  date_from        TEXT NOT NULL,
  phase            TEXT NOT NULL DEFAULT 'maintain' CHECK (phase IN ('bulk','cut','maintain')),
  target_kcal      REAL NOT NULL,
  target_protein_g REAL NOT NULL,
  target_fat_g     REAL NOT NULL,
  target_carbs_g   REAL NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_nutrition_targets_from ON nutrition_targets(date_from);

-- ============ マスタ: 筋部位(シード固定, ヒートマップ単位) ============
CREATE TABLE muscle_groups (
  id                 TEXT PRIMARY KEY,
  name_ja            TEXT NOT NULL,
  name_en            TEXT NOT NULL,
  region             TEXT NOT NULL CHECK (region IN ('upper_push','upper_pull','legs','core')),
  body_side          TEXT NOT NULL CHECK (body_side IN ('front','back')),
  svg_region_id      TEXT NOT NULL,
  weekly_target_sets INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ マスタ: 種目(free-exercise-db seed) ============
CREATE TABLE exercises (
  id                TEXT PRIMARY KEY,
  name_en           TEXT NOT NULL,
  name_ja           TEXT,
  category          TEXT NOT NULL CHECK (category IN ('compound','isolation','cardio')),
  equipment         TEXT,
  movement_pattern  TEXT,
  laterality        TEXT NOT NULL DEFAULT 'bilateral' CHECK (laterality IN ('bilateral','unilateral')),
  load_basis        TEXT NOT NULL DEFAULT 'total' CHECK (load_basis IN ('total','per_limb','per_side')),
  is_bodyweight     INTEGER NOT NULL DEFAULT 0,
  bw_factor         REAL NOT NULL DEFAULT 1.0,
  default_rep_range TEXT,
  gh_exercise_type  TEXT,
  images            TEXT NOT NULL DEFAULT '[]',
  instructions      TEXT NOT NULL DEFAULT '[]',
  is_custom         INTEGER NOT NULL DEFAULT 0,
  is_favorite       INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ 種目↔部位 多対多 + 効き係数(PK=ペアで二重計上不可, §8.3) ============
CREATE TABLE exercise_muscles (
  exercise_id     TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_group_id TEXT NOT NULL REFERENCES muscle_groups(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('primary','secondary','stabilizer')),
  contribution    REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (exercise_id, muscle_group_id)
);
CREATE INDEX idx_exercise_muscles_muscle ON exercise_muscles(muscle_group_id);

-- ============ ワークアウトテンプレート(PPL等。session より前に定義) ============
CREATE TABLE workout_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  region_focus TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE template_exercises (
  id             TEXT PRIMARY KEY,
  template_id    TEXT NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  exercise_id    TEXT NOT NULL REFERENCES exercises(id),
  order_index    INTEGER NOT NULL,
  target_sets    INTEGER,
  superset_group INTEGER
);
CREATE INDEX idx_template_exercises_template ON template_exercises(template_id);
CREATE TABLE template_sets (
  id                   TEXT PRIMARY KEY,
  template_exercise_id TEXT NOT NULL REFERENCES template_exercises(id) ON DELETE CASCADE,
  set_index            INTEGER NOT NULL,
  target_entry_value   REAL,
  target_entry_unit    TEXT NOT NULL DEFAULT 'kg' CHECK (target_entry_unit IN ('kg','lb')),
  target_reps          INTEGER,
  target_rpe           REAL,
  set_type             TEXT NOT NULL DEFAULT 'main'
);

-- ============ ワークアウトセッション(=GH同期の単位) ============
CREATE TABLE workout_sessions (
  id                  TEXT PRIMARY KEY,
  date                TEXT NOT NULL,
  started_at          INTEGER NOT NULL,
  ended_at            INTEGER,
  title               TEXT,
  template_id         TEXT REFERENCES workout_templates(id) ON DELETE SET NULL,
  note                TEXT,
  bodyweight_kg       REAL,
  total_volume_kg     REAL NOT NULL DEFAULT 0,
  active_duration_sec INTEGER,
  est_calories        INTEGER,
  status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','stale')),
  source              TEXT NOT NULL DEFAULT 'app',
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_workout_sessions_date ON workout_sessions(date);
CREATE INDEX idx_workout_sessions_status ON workout_sessions(status);

-- ============ セッション内の種目エントリ ============
CREATE TABLE workout_exercises (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id    TEXT NOT NULL REFERENCES exercises(id),
  order_index    INTEGER NOT NULL,
  superset_group INTEGER,
  note           TEXT
);
CREATE INDEX idx_workout_exercises_session ON workout_exercises(session_id);

-- ============ セット明細(最多行) ============
CREATE TABLE workout_sets (
  id                  TEXT PRIMARY KEY,
  workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_index           INTEGER NOT NULL,
  set_type            TEXT NOT NULL DEFAULT 'main'
                        CHECK (set_type IN ('warmup','main','drop','backoff','amrap','failure')),
  load_mode           TEXT NOT NULL DEFAULT 'weighted'
                        CHECK (load_mode IN ('weighted','bodyweight','assisted')),
  entry_value         REAL,
  entry_unit          TEXT NOT NULL DEFAULT 'kg' CHECK (entry_unit IN ('kg','lb')),
  weight_kg           REAL,
  reps                INTEGER,
  rpe                 REAL,
  rest_sec            INTEGER,
  is_completed        INTEGER NOT NULL DEFAULT 1,
  performed_at        INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_sets_we ON workout_sets(workout_exercise_id);
CREATE INDEX idx_sets_exercise_time ON workout_sets(workout_exercise_id, performed_at);

-- ============ PR台帳(value は常に kg 正規化値, §8.2) ============
CREATE TABLE personal_records (
  id              TEXT PRIMARY KEY,
  exercise_id     TEXT NOT NULL REFERENCES exercises(id),
  record_type     TEXT NOT NULL
                    CHECK (record_type IN ('e1rm','weight_at_reps','max_reps_at_weight','max_volume_session')),
  rep_bucket      INTEGER,
  value           REAL NOT NULL,
  unit            TEXT NOT NULL DEFAULT 'kg' CHECK (unit = 'kg'),
  is_provisional  INTEGER NOT NULL DEFAULT 0,
  pr_basis        TEXT CHECK (pr_basis IS NULL OR pr_basis IN ('rpe_backed','amrap','failure','rpe_less')),
  achieved_set_id TEXT REFERENCES workout_sets(id) ON DELETE SET NULL,
  achieved_at     INTEGER NOT NULL
);
CREATE INDEX idx_pr_exercise ON personal_records(exercise_id, record_type);

-- ============ 食事プリセット(meal_items より前に定義) ============
CREATE TABLE meal_presets (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  items_json        TEXT NOT NULL,
  default_meal_type TEXT NOT NULL DEFAULT 'Anytime',
  use_count         INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ 食事 ============
CREATE TABLE meals (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  logged_at    INTEGER NOT NULL,
  meal_type    TEXT NOT NULL
                 CHECK (meal_type IN ('Breakfast','MorningSnack','Lunch','AfternoonSnack','Dinner','Anytime')),
  note         TEXT,
  photo_r2_key TEXT,
  input_method TEXT NOT NULL DEFAULT 'manual' CHECK (input_method IN ('manual','photo','preset')),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_meals_date ON meals(date);

-- ============ 食事の食材明細(PFCをアプリ側で完全保持) ============
CREATE TABLE meal_items (
  id            TEXT PRIMARY KEY,
  meal_id       TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  preset_id     TEXT REFERENCES meal_presets(id) ON DELETE SET NULL,
  food_name     TEXT NOT NULL,
  quantity      REAL NOT NULL DEFAULT 1,
  unit          TEXT NOT NULL DEFAULT 'serving',
  calories_kcal REAL NOT NULL,
  protein_g     REAL NOT NULL DEFAULT 0,
  fat_g         REAL NOT NULL DEFAULT 0,
  carbs_g       REAL NOT NULL DEFAULT 0,
  fiber_g       REAL,
  sugar_g       REAL,
  sodium_mg     REAL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_meal_items_meal ON meal_items(meal_id);
CREATE INDEX idx_meal_items_foodname ON meal_items(food_name);

-- ============ 体組成(GHミラー + 手動) ============
CREATE TABLE body_metrics (
  id             TEXT PRIMARY KEY,
  date           TEXT NOT NULL,
  measured_at    INTEGER NOT NULL,
  entry_value    REAL,
  entry_unit     TEXT CHECK (entry_unit IS NULL OR entry_unit IN ('kg','lb')),
  weight_kg      REAL,
  body_fat_pct   REAL,
  source         TEXT NOT NULL CHECK (source IN ('google_health','app')),
  gh_external_id TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX idx_body_metrics_gh ON body_metrics(gh_external_id) WHERE gh_external_id IS NOT NULL;
CREATE INDEX idx_body_metrics_date ON body_metrics(date);

-- ============ 周径(将来拡張, §1.4) ============
CREATE TABLE body_measurements (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  site       TEXT NOT NULL,
  value_cm   REAL NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_body_measurements_date ON body_measurements(date, site);

-- ============ 睡眠ミラー(GH SoT) ============
CREATE TABLE sleep_logs (
  id             TEXT PRIMARY KEY,
  date           TEXT NOT NULL,
  start_at       INTEGER NOT NULL,
  end_at         INTEGER NOT NULL,
  total_min      INTEGER NOT NULL,
  deep_min       INTEGER,
  light_min      INTEGER,
  rem_min        INTEGER,
  awake_min      INTEGER,
  efficiency     REAL,
  source         TEXT NOT NULL DEFAULT 'google_health' CHECK (source IN ('google_health','app')),
  gh_external_id TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX idx_sleep_gh ON sleep_logs(gh_external_id) WHERE gh_external_id IS NOT NULL;
CREATE INDEX idx_sleep_date ON sleep_logs(date);

-- ============ センシング日次ミラー(SpO2/HRV/皮膚温/呼吸数/安静時心拍/VO2max/歩数) ============
CREATE TABLE daily_metrics (
  date           TEXT NOT NULL,
  metric         TEXT NOT NULL
                   CHECK (metric IN ('spo2_avg','resp_rate','hrv_rmssd','skin_temp_c','resting_hr','vo2max','steps')),
  value          REAL NOT NULL,
  unit           TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'google_health' CHECK (source IN ('google_health','app')),
  gh_external_id TEXT,
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (date, metric)
);

-- ============ GH同期台帳(食事/ワークアウト/体重 の push 状態) ============
CREATE TABLE gh_sync_state (
  entity_type      TEXT NOT NULL CHECK (entity_type IN ('workout','meal','body_metric')),
  entity_id        TEXT NOT NULL,
  gh_datapoint_id  TEXT,
  gh_data_origin   TEXT,
  sync_status      TEXT NOT NULL DEFAULT 'pending'
                     CHECK (sync_status IN ('pending','synced','failed','stale','deleted_remote','skipped_flag_off')),
  last_pushed_hash TEXT,
  last_pushed_at   INTEGER,
  retry_count      INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX idx_gh_sync_status ON gh_sync_state(sync_status);

-- ============ daily batch 同期状態(GH dataType ID 単位) ============
CREATE TABLE sync_runs (
  data_type            TEXT PRIMARY KEY,
  last_synced_at       INTEGER,
  last_cursor          TEXT,
  last_status          TEXT NOT NULL DEFAULT 'idle' CHECK (last_status IN ('idle','running','ok','error')),
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
);

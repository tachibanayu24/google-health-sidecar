-- AI作成トレーニングルーティン(参照専用ライブラリ。MCPでCRUD・Webで参照)。design.md §8.10 / enhancements 新規。
-- routine(メニュー本体) → routine_days(日=カテゴリ単位) → routine_exercises(日内の種目)。
-- 種目はカタログ(exercises)の FK 必須(自由入力不可)→ exercise_muscles 経由で人体図を自動生成。
-- 荷重は任意。セット/レップは範囲を保つため min/max 整数。記録(workout)とは独立(計画の参照)。

CREATE TABLE routines (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,                       -- "6日サイクル"
  goal       TEXT,                                -- 副題 "減量フェーズ(体脂肪15%…)"
  notes      TEXT,                                -- 方針/運用ルール/位置づけ(プレーンテキスト整形)
  is_active  INTEGER NOT NULL DEFAULT 0,          -- 現在運用中(1つだけ想定)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE routine_days (
  id         TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,                    -- 1..N 並び
  label      TEXT,                                -- "Day 1"
  title      TEXT NOT NULL,                       -- "胸(強化)+三頭" / "レスト"
  aim        TEXT,                                -- 狙い "胸の重量+ボリューム"
  main_lift  TEXT,                                -- BIG3/主種目 "ベンチプレス"(表示用)
  is_rest    INTEGER NOT NULL DEFAULT 0,
  note       TEXT                                 -- 日ごとの補足段落
);

CREATE TABLE routine_exercises (
  id              TEXT PRIMARY KEY,
  day_id          TEXT NOT NULL REFERENCES routine_days(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  exercise_id     TEXT NOT NULL REFERENCES exercises(id),  -- カタログ必須
  alt_exercise_id TEXT REFERENCES exercises(id),           -- "X or Y" の代替
  sets_min        INTEGER,
  sets_max        INTEGER,
  reps_min        INTEGER,
  reps_max        INTEGER,
  target_load     TEXT,                                    -- 任意 "60kg"/"自重〜加重" 等
  note            TEXT                                     -- 種目ごとの狙い
);

CREATE INDEX idx_routine_days_routine ON routine_days(routine_id, position);
CREATE INDEX idx_routine_exercises_day ON routine_exercises(day_id, position);

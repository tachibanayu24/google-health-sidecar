-- 0013: 利用者AIテストで判明した穴を埋める。
--  (1) hip-abduction(ヒップアブダクション)種目が無かったため追加(glutes 主働)。
--  (2) 脚/体幹/その他の日本語俗称・略称エイリアスを拡充(運用で育てる第一弾)。

-- (1) 種目追加
INSERT OR IGNORE INTO exercises
  (id, name_en, name_ja, category, equipment, movement_pattern, load_basis, default_rep_range, gh_exercise_type)
VALUES
  ('hip-abduction', 'Hip Abduction', 'ヒップアブダクション', 'isolation', 'machine', 'hip_abduction', 'total', '12-20', 'STRENGTH_TRAINING');
INSERT OR IGNORE INTO exercise_muscles (exercise_id, muscle_group_id, role, contribution) VALUES
  ('hip-abduction', 'glutes', 'primary', 1.0);

-- (2) エイリアス拡充(name_ja に無い俗称・略称を中心に)
INSERT OR IGNORE INTO exercise_aliases (exercise_id, alias) VALUES
  ('hip-abduction', 'アブダクション'),
  ('hip-abduction', '外転'),
  ('hip-abduction', '股関節外転'),
  ('calf-raise', 'カーフ'),
  ('leg-curl', 'ハムカール'),
  ('leg-extension', 'レッグエクステ'),
  ('leg-extension', 'エクステンション'),
  ('hack-squat', 'ハック'),
  ('walking-lunge', 'ランジ'),
  ('hip-thrust', 'スラスト'),
  ('romanian-deadlift', 'RDL'),
  ('romanian-deadlift', 'ルーマニアン'),
  ('hanging-leg-raise', 'レッグレイズ'),
  ('cable-crunch', 'クランチ'),
  ('russian-twist', 'ツイスト'),
  ('face-pull', 'フェイスプル'),
  ('seated-cable-row', 'シーテッドロウ'),
  ('lateral-raise', 'サイドレイズ');

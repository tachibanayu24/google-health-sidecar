-- 初期シード(冪等: INSERT OR IGNORE)。設計書 §7 末尾 + §8.3。
-- 日本語種目名は LLM バッチ翻訳で後追い補完(§14#12)。svg_region_id は M1 で body-highlighter に対応付け。

-- ============ 設定(単一行) ============
INSERT OR IGNORE INTO settings (id, unit_preference, e1rm_formula, locale)
VALUES (1, 'kg', 'epley', 'ja');

-- ============ 栄養目標(初期 maintain。設定UIで変更, §9.1) ============
INSERT OR IGNORE INTO nutrition_targets
  (id, date_from, phase, target_kcal, target_protein_g, target_fat_g, target_carbs_g)
VALUES
  ('seed_initial', '2026-05-31', 'maintain', 2200, 165, 60, 250);

-- ============ 筋部位(16, ヒートマップ単位) ============
INSERT OR IGNORE INTO muscle_groups (id, name_ja, name_en, region, body_side, svg_region_id, weekly_target_sets) VALUES
  ('chest',       '胸',     'Chest',        'upper_push', 'front', 'chest',        14),
  ('lats',        '広背筋', 'Lats',         'upper_pull', 'back',  'upper-back',   16),
  ('traps',       '僧帽筋', 'Trapezius',    'upper_pull', 'back',  'trapezius',    10),
  ('front_delts', '前部三角筋', 'Front Delts', 'upper_push', 'front', 'front-deltoids', 8),
  ('side_delts',  '中部三角筋', 'Side Delts',  'upper_push', 'front', 'deltoids',    10),
  ('rear_delts',  '後部三角筋', 'Rear Delts',  'upper_pull', 'back',  'back-deltoids', 8),
  ('biceps',      '上腕二頭筋', 'Biceps',      'upper_pull', 'front', 'biceps',      10),
  ('triceps',     '上腕三頭筋', 'Triceps',     'upper_push', 'back',  'triceps',     10),
  ('forearms',    '前腕',   'Forearms',     'upper_pull', 'front', 'forearm',      6),
  ('abs',         '腹直筋', 'Abs',          'core',       'front', 'abs',          8),
  ('obliques',    '腹斜筋', 'Obliques',     'core',       'front', 'obliques',     6),
  ('quads',       '大腿四頭筋', 'Quadriceps', 'legs',     'front', 'quadriceps',   14),
  ('hamstrings',  'ハムストリング', 'Hamstrings', 'legs',  'back',  'hamstring',    12),
  ('glutes',      '臀筋',   'Glutes',       'legs',       'back',  'gluteal',      12),
  ('calves',      'ふくらはぎ', 'Calves',     'legs',      'back',  'calves',       10),
  ('lower_back',  '脊柱起立筋', 'Lower Back', 'core',      'back',  'lower-back',   6);

-- ============ 種目(BIG3 + 主要) ============
INSERT OR IGNORE INTO exercises
  (id, name_en, name_ja, category, equipment, movement_pattern, laterality, load_basis, is_bodyweight, bw_factor, default_rep_range, gh_exercise_type) VALUES
  ('barbell-bench-press', 'Barbell Bench Press', 'バーベルベンチプレス', 'compound', 'barbell', 'horizontal_push', 'bilateral', 'total', 0, 1.0, '5-10', 'STRENGTH_TRAINING'),
  ('barbell-back-squat',  'Barbell Back Squat',  'バーベルバックスクワット', 'compound', 'barbell', 'squat', 'bilateral', 'total', 0, 1.0, '5-8', 'STRENGTH_TRAINING'),
  ('conventional-deadlift', 'Conventional Deadlift', 'デッドリフト', 'compound', 'barbell', 'hinge', 'bilateral', 'total', 0, 1.0, '3-6', 'STRENGTH_TRAINING'),
  ('overhead-press', 'Overhead Press', 'オーバーヘッドプレス', 'compound', 'barbell', 'vertical_push', 'bilateral', 'total', 0, 1.0, '5-10', 'STRENGTH_TRAINING'),
  ('pull-up', 'Pull-Up', 'チンニング', 'compound', 'bodyweight', 'vertical_pull', 'bilateral', 'total', 1, 1.0, '6-12', 'STRENGTH_TRAINING'),
  ('dip', 'Dip', 'ディップス', 'compound', 'bodyweight', 'vertical_push', 'bilateral', 'total', 1, 1.0, '8-15', 'STRENGTH_TRAINING'),
  ('dumbbell-curl', 'Dumbbell Curl', 'ダンベルカール', 'isolation', 'dumbbell', 'elbow_flexion', 'unilateral', 'per_limb', 0, 1.0, '8-15', 'STRENGTH_TRAINING'),
  ('lat-pulldown', 'Lat Pulldown', 'ラットプルダウン', 'compound', 'cable', 'vertical_pull', 'bilateral', 'total', 0, 1.0, '8-15', 'STRENGTH_TRAINING');

-- ============ 種目↔部位(primary=1.0 / secondary=0.5 を明示) ============
INSERT OR IGNORE INTO exercise_muscles (exercise_id, muscle_group_id, role, contribution) VALUES
  -- ベンチプレス
  ('barbell-bench-press', 'chest',       'primary',   1.0),
  ('barbell-bench-press', 'front_delts', 'secondary', 0.5),
  ('barbell-bench-press', 'triceps',     'secondary', 0.5),
  -- スクワット
  ('barbell-back-squat',  'quads',       'primary',   1.0),
  ('barbell-back-squat',  'glutes',      'secondary', 0.5),
  ('barbell-back-squat',  'hamstrings',  'secondary', 0.5),
  ('barbell-back-squat',  'lower_back',  'stabilizer', 0.25),
  -- デッドリフト
  ('conventional-deadlift', 'hamstrings', 'primary',   1.0),
  ('conventional-deadlift', 'glutes',     'secondary', 0.5),
  ('conventional-deadlift', 'lower_back', 'secondary', 0.5),
  ('conventional-deadlift', 'traps',      'stabilizer', 0.25),
  -- OHP
  ('overhead-press', 'front_delts', 'primary',   1.0),
  ('overhead-press', 'side_delts',  'secondary', 0.5),
  ('overhead-press', 'triceps',     'secondary', 0.5),
  -- 懸垂
  ('pull-up', 'lats',       'primary',   1.0),
  ('pull-up', 'biceps',     'secondary', 0.5),
  ('pull-up', 'rear_delts', 'secondary', 0.5),
  -- ディップス
  ('dip', 'chest',       'primary',   1.0),
  ('dip', 'triceps',     'secondary', 0.5),
  ('dip', 'front_delts', 'secondary', 0.5),
  -- ダンベルカール
  ('dumbbell-curl', 'biceps',   'primary',   1.0),
  ('dumbbell-curl', 'forearms', 'secondary', 0.5),
  -- ラットプルダウン
  ('lat-pulldown', 'lats',   'primary',   1.0),
  ('lat-pulldown', 'biceps', 'secondary', 0.5);

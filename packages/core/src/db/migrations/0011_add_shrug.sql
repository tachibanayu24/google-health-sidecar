-- 0011: シュラッグ追加。僧帽筋(上部)を主働で鍛える種目がカタログに無かったため
--       (既存は row/face-pull/deadlift で traps を secondary/stabilizer に巻き込むのみ)。
--       命名は王道種目の規約に従い装備接頭辞なしの "Shrug"。
INSERT OR IGNORE INTO exercises
  (id, name_en, name_ja, category, equipment, movement_pattern, load_basis, default_rep_range, gh_exercise_type)
VALUES
  ('shrug', 'Shrug', 'シュラッグ', 'isolation', 'barbell', 'shrug', 'total', '8-15', 'STRENGTH_TRAINING');

INSERT OR IGNORE INTO exercise_muscles (exercise_id, muscle_group_id, role, contribution) VALUES
  ('shrug', 'traps',    'primary',    1.0),
  ('shrug', 'forearms', 'stabilizer', 0.25);

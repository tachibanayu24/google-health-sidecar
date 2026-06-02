-- 0012: 種目エイリアス辞書(§5.5-F)。
--  free-exercise-db は英語ベースのため、日本語俗称・マシンブランド名・略称が name_en/name_ja で
--  引けないと記録のたびに往復が増える(利用者AIレビューで「体感品質の最大要因」と指摘)。
--  searchExercises を name_en/name_ja に加え alias 横断一致へ拡張する。運用後にミスヒットを継続拡充。
CREATE TABLE exercise_aliases (
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,
  PRIMARY KEY (exercise_id, alias)
);
CREATE INDEX idx_exercise_alias ON exercise_aliases(alias);

INSERT OR IGNORE INTO exercise_aliases (exercise_id, alias) VALUES
  ('barbell-bench-press', 'ベンチ'),
  ('incline-barbell-bench-press', 'インクラインベンチ'),
  ('dumbbell-bench-press', 'ダンベルベンチ'),
  ('close-grip-bench-press', 'ナローベンチ'),
  ('back-squat', 'スクワット'),
  ('conventional-deadlift', 'デッド'),
  ('romanian-deadlift', 'ルーマニアン'),
  ('hs-iso-incline-press', 'アイソラテラルインクライン'),
  ('hs-iso-incline-press', 'ハンマーストレングス'),
  ('hs-iso-low-row', 'アイソラテラルローロウ'),
  ('hs-iso-wide-chest', 'アイソラテラルワイドチェスト'),
  ('hs-iso-wide-pulldown', 'アイソラテラルワイドプルダウン'),
  ('pec-deck-fly', 'ペックフライ'),
  ('triceps-pushdown', 'プレスダウン'),
  ('lateral-raise', 'サイドレイズ'),
  ('overhead-press', 'OHP'),
  ('chin-up', 'チンニング'),
  ('pull-up', '懸垂'),
  ('shrug', '僧帽');

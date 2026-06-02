-- 0015: エイリアス継続拡充(第3弾)。name_en/name_ja に当たらない一般的俗称・略称を補う。
--  実カタログ(56種目)を見て、現状の部分一致で引けないものだけを厳選。
INSERT OR IGNORE INTO exercise_aliases (exercise_id, alias) VALUES
  ('push-up', '腕立て'),
  ('push-up', '腕立て伏せ'),
  ('triceps-pushdown', 'プッシュダウン'), -- 名称は「プレスダウン」だが俗称はプッシュダウンが多い
  ('t-bar-row', 'Tバーロウ'),             -- 名称は全角「ティーバー」なので Tバー では当たらない
  ('t-bar-row', 'Tバー'),
  ('rear-delt-fly', 'リアデルト'),         -- 名称は「リアレイズ」
  ('rear-delt-fly', 'リアフライ'),
  ('cable-crossover', 'ケーブルフライ'),
  ('dip', 'ディップ');

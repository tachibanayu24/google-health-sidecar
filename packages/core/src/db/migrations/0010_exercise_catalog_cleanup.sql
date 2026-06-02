-- 0010: 種目カタログのクリーンアップ
--  (1) 重複スクワットの解消: 0002 seed の `barbell-back-squat` と 0004 catalog の `back-squat` が
--      ともに name_en="Barbell Back Squat" でピッカーに2行出ていた。`back-squat` を正とし統合。
--      既存参照があれば付け替えてから削除(安全網; 本番は使用0を確認済 2026-06-02)。
--  (2) 基本種目の名称正規化: 装備が自明な王道種目から接頭辞(Barbell/Conventional)を除去。
--      変種区別が要るもの(Barbell Curl, Dumbbell/Incline 系, Front/Hack Squat 等)は据え置き。

-- (1) 重複統合(全参照を back-squat に付け替えてから削除。FK 非CASCADE の参照も明示処理)
UPDATE workout_exercises  SET exercise_id = 'back-squat' WHERE exercise_id = 'barbell-back-squat';
UPDATE template_exercises SET exercise_id = 'back-squat' WHERE exercise_id = 'barbell-back-squat';
UPDATE personal_records   SET exercise_id = 'back-squat' WHERE exercise_id = 'barbell-back-squat';
DELETE FROM exercise_muscles WHERE exercise_id = 'barbell-back-squat';
DELETE FROM exercises WHERE id = 'barbell-back-squat';

-- (2) 王道種目の正規化(ID は不変なので既存参照に影響なし)
UPDATE exercises SET name_en = 'Squat',              name_ja = 'スクワット'              WHERE id = 'back-squat';
UPDATE exercises SET name_en = 'Bench Press',        name_ja = 'ベンチプレス'            WHERE id = 'barbell-bench-press';
UPDATE exercises SET name_en = 'Deadlift',           name_ja = 'デッドリフト'            WHERE id = 'conventional-deadlift';
UPDATE exercises SET name_en = 'Hip Thrust',         name_ja = 'ヒップスラスト'          WHERE id = 'hip-thrust';
UPDATE exercises SET name_en = 'Bent-Over Row',      name_ja = 'ベントオーバーロウ'      WHERE id = 'barbell-row';
UPDATE exercises SET name_en = 'Incline Bench Press', name_ja = 'インクラインベンチプレス' WHERE id = 'incline-barbell-bench-press';

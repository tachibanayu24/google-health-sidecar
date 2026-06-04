-- ワークアウトのメモ著者(UI=user / MCP の AI=ai)。既存 note カラムに付随。
-- 単一メモ欄 + 著者ラベル(last-writer-wins)。NULL=メモ無し。AI が書いたら 'ai' で UI/export にラベル表示。
ALTER TABLE workout_sessions ADD COLUMN note_author TEXT CHECK (note_author IN ('user', 'ai'));

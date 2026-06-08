-- トレーナーAI(Claude)が生成・保存する週次レポート(docs/weekly-report-design.md)。
-- 生成はアプリ/cron ではなく MCP 経由(Claude)。D1 ローカルのみで GH 非同期・gh_sync_state 非登録
-- (routines と同じ WRITE_LOCAL。entity_type 拡張不要・cron retryPendingPushes 対象外)。
-- week_start(JST日曜)を自然キーにし「1週1レポート」を保証。再保存は ON CONFLICT で上書き(版管理しない)。
CREATE TABLE weekly_reports (
  week_start         TEXT PRIMARY KEY,                 -- JST 日曜 'YYYY-MM-DD'(対象週=日〜土の固定窓)
  week_end           TEXT NOT NULL CHECK (week_end > week_start),

  -- スコア(0-100 整数。データ不足の観点は NULL=未採点。トレンド化のためスカラ列+範囲CHECK)。
  -- 採点は Claude が description のルーブリックで写像(charter 棲み分けは §0.1)。
  overall_score      INTEGER CHECK (overall_score   IS NULL OR overall_score   BETWEEN 0 AND 100),
  training_score     INTEGER CHECK (training_score  IS NULL OR training_score  BETWEEN 0 AND 100),
  nutrition_score    INTEGER CHECK (nutrition_score IS NULL OR nutrition_score BETWEEN 0 AND 100),
  recovery_score     INTEGER CHECK (recovery_score  IS NULL OR recovery_score  BETWEEN 0 AND 100),
  body_score         INTEGER CHECK (body_score      IS NULL OR body_score      BETWEEN 0 AND 100),

  -- 講評(MECE: 各列=1関心。headline が統合・各 note は詳細。重複させない)。
  headline           TEXT NOT NULL,
  training_note      TEXT,
  nutrition_note     TEXT,
  recovery_note      TEXT,
  body_note          TEXT,
  focus_next_week    TEXT,

  -- ヒアリングで得た主観文脈(Claude が会話から渡す一次情報=サーバは recompute 不能)。
  -- metrics_json(決定的)とは別カラムで権威を分離。構造化シグナル/スコアの決定的入力にはしない(§3.2/§8)。
  subjective_context TEXT,

  -- 生成時点の決定的メトリクス snapshot(画像レンダリング・再現性・後のデータ編集に不変)。
  -- 内部に schema_version と sensingProvenance/as_of を含む(主観は混ぜない)。
  metrics_json       TEXT NOT NULL,

  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
-- インデックスは張らない: week_start が PRIMARY KEY=一意インデックス自動生成、
-- ORDER BY week_start DESC は PK インデックスの逆走査で賄える(sync_runs 同様に追加 index なし)。

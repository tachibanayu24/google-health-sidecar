# 設計書: 週次レポート(トレーナーAI生成・MCP保存)【DRAFT — 承認待ち】

> ステータス: **設計のみ。オーナー承認後に実装着手**(2026-06-08 起草)。
> 確定済み(2026-06-08): スコア尺度=**0-100**、採点=**ハイブリッド**(測れる下位指標は決定的に出し Claude が規定写像)。
> 残る C/D/E(§10)は提案デフォルトで進める想定(異議があれば変更)。実装着手はオーナーの GO 待ち。
> 関連: `docs/design.md`(charter §0.5 / §8.5 単一書込みパス)、`docs/mcp-design.md`、`docs/nutrition-scoring-design.md`、`README.md` データ表。

## 0. 位置づけ(charter との整合)

このアプリの charter は「**決定的計算はアプリが出し、判断と語りは Claude(MCP)が担う**」。週次レポートは**その語りを初めて永続化する箱**である。

- 週次レポート = **Claude の総合判断+講評+スコア**を、決定的メトリクスの snapshot とともに D1 に保存したもの。
- **アプリは生成しない(cron 不採用)**。生成は 100% トレーナーAI が MCP 経由。アプリの役割は**保存・一覧・詳細・画像エクスポート**に限定。
- GH には同期しない(GH が構造的に持てない一級データ=モート。D4 原則の「GHで扱えないデータのみ自前で持つ」側)。`WRITE_LOCAL`(D1のみ、`ghPushed` 概念なし)。
- **通知しない(D1 決定)**。生成トリガはオーナーと Claude の自由会話(「今週どうだった?」等)か、Claude が日曜の会話で自発的に作る。アプリは受け身。

## 1. 週の境界

- **JST 日曜 00:00 〜 土曜 24:00 の固定週**(前の完了週)。rolling 7 日ではない。
- `weekStart` = 対象週の日曜 `YYYY-MM-DD`(JST)。`weekEnd` = その土曜。
- 既存 `getWeeklySummaryNow` は**当日含む直近7日(rolling)**なので流用不可。**固定 Sun–Sat 窓**の集計関数を新設する(§4)。
- 「直近の完了週」= 今日(JST)が属する週の**1つ前**の日曜〜土曜。`weekStart` 省略時はこれを既定にする。

## 2. スキーマ(箱)— migration `0020_weekly_reports.sql`

`week_start` を**自然キー(PRIMARY KEY)**にして「1週=1レポート」を構造的に保証(再保存=上書き)。前例: `sync_runs` も `data_type` を自然キー PK にしている。

```sql
-- トレーナーAI が生成・保存する週次レポート(D1 ローカル・GH 非同期)。
-- week_start(JST日曜)を自然キーにし「1週1レポート」を保証。再保存は上書き(最新の講評で置換)。
CREATE TABLE weekly_reports (
  week_start       TEXT PRIMARY KEY,          -- JST 日曜 'YYYY-MM-DD'
  week_end         TEXT NOT NULL,             -- JST 土曜

  -- スコア(0-100 整数・トレンド化のためスカラ列。データ不足の観点は NULL=未採点)
  overall_score    INTEGER,
  training_score   INTEGER,
  nutrition_score  INTEGER,
  recovery_score   INTEGER,                   -- 睡眠 + readiness
  body_score       INTEGER,                   -- フェーズ整合(cut/bulk/maintain)

  -- 講評(MECE: 各列=1関心。重複を書かない。headline が統合、各 note は詳細)
  headline         TEXT NOT NULL,             -- 総評(週を1段落で要約)
  training_note    TEXT,                      -- トレーニング(量/頻度/部位バランス/伸び)
  nutrition_note   TEXT,                      -- 栄養(目標適合/マクロ/記録一貫性/質)
  recovery_note    TEXT,                      -- 睡眠・回復(睡眠/HRV/RHR/皮膚温の傾向)
  body_note        TEXT,                      -- からだ(体重・体組成のフェーズ整合)
  focus_next_week  TEXT,                      -- 来週のフォーカス(1〜3点・前向き)

  -- 生成時点の決定的メトリクス snapshot(再現性・画像レンダリング・後からのデータ編集に不変)
  metrics_json     TEXT NOT NULL,             -- get_week_review_data の返り値を凍結

  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_weekly_reports_week ON weekly_reports(week_start DESC);
```

設計判断:
- **スコアはスカラ列**(JSON に埋めない)→ `SELECT week_start, overall_score …` で**週次トレンドを引ける**(将来「スコア推移」グラフが安価)。
- **講評は関心ごとに1列**(自由 JSON にしない)→ **MECE を構造で強制**。「総評に書いたことを各 note で繰り返さない」を列の役割で担保。画像レンダラもフィールド固定で密度設計しやすい。
- **`metrics_json` で生成時の数値を凍結** → 後でデータを編集/削除しても**レポートは当時の事実のまま**(週次振り返りの誠実さ)。画像は snapshot から描く=recompute 不要・確定的。

## 3. スコアリング・ルーブリック(MCP description に常駐 → 毎回同基準)

「いつ呼んでも同じ基準」を担保するため、**ルーブリックを `save_weekly_report` の description に固定**する。さらに**ブレを抑えるためハイブリッド**にする: 決定的に出せる下位スコアは `get_week_review_data` が返し、Claude はそれを**規定の対応表でディメンションスコアに写像**して講評を書く(实测主义=測れる所は測り、語りは Claude)。

各ディメンション 0-100。`get_week_review_data` が返す決定的素材(右)を、description の対応表で写像する:

| ディメンション | 決定的素材(data pack が提供) | 写像の骨子(description に明記) |
|---|---|---|
| **training** | 部位別 landmark_zone の分布(optimal/building/under/over の部位数)、セッション数、PR件数、停滞指標 | optimal 帯の部位割合が高く・計画頻度を満たし・伸び(PR/e1RM上昇)があるほど高。under 過多や over 続出は減点 |
| **nutrition** | 各日の `get_nutrition_score`(既存ルーブリック)の平均、記録日数/7、フェーズ別目標適合 | 既存食事スコア平均 × 記録一貫性。たんぱく質適合と収支ゲートを重視(§nutrition-scoring-design) |
| **recovery** | 平均睡眠時間/効率、readiness の green/yellow/red 日数、HRV/RHR の平常逸脱、皮膚温 | 睡眠充足 + readiness が緑寄り + HRV 平常以上 ほど高。赤日連発は減点 |
| **body** | `get_nutrition_status` の weightTrend・estimatedTdee vs 摂取、フェーズ | フェーズ目標に沿う変化(cut=狙い通り減/bulk=制御された増/maintain=安定)ほど高 |
| **overall** | 上記4つ | 規定の加重(例 training 0.30 / nutrition 0.30 / recovery 0.25 / body 0.15)で統合。ただし**致命的な穴(記録ゼロ・赤日連発)があれば上限ゲート** |

- データ不足のディメンションは**採点しない(NULL)**=偽の数字を出さない(实测主义)。description で「無採点は NULL」と明示。
- スコア帯のラベル(例 85-100 優秀 / 70-84 良好 / 50-69 要改善 / <50 立て直し)も description に固定。
- **既存 `nutrition-score.ts` を二重実装しない**: nutrition ディメンションは既存の食事スコア(台形バンド+加重幾何平均)の週平均を素材に使う。

## 4. core(`packages/core/src/services/weekly-report.ts`・新規)

単一書込みパス(§8.5)に従い、生 SQL は services に閉じる。

- `getWeekReviewData(ctx, weekStart?)`: 固定 Sun–Sat 窓の**決定的データパック**を返す。中身 = 既存 `getWeeklySummary` の固定窓版 + 部位別 landmark_zone 分布 + 各日 nutrition score の平均 + readiness の日次信号集計 + PR一覧 + nutrition status(TDEE/体重トレンド)。**ルーブリックの素材を1本で揃える**(Claude の往復削減・採点入力の一貫性)。
- `saveWeeklyReport(ctx, input)`: `week_start` で upsert。**サーバが保存時に `getWeekReviewData` を呼んで `metrics_json` を自前で凍結**(Claude はスコア+講評のみ渡す。数値の snapshot は権威をサーバが持つ)。返り値 `{ weekStart, created: boolean }`。
- `getWeeklyReport(ctx, weekStart?)` / `listWeeklyReports(ctx, limit?)`: 取得・一覧。
- 週境界ユーティリティ: `lastCompletedWeekJst()` → `{ weekStart, weekEnd }`(`util/date` に追加)。
- 既存 `getWeeklySummary` を「窓を引数化」する小リファクタで固定窓に対応(rolling 既定は維持)。

## 5. MCP ツール(`apps/mcp/src/index.ts` に追加・read系/write系の登録関数へ)

| ツール | 種別 | 役割 |
|---|---|---|
| `get_week_review_data` | read | 指定週(省略=直近完了週)の**決定的データパック**。Claude が採点・講評の前に読む素材 |
| `save_weekly_report` | write(`WRITE_LOCAL`) | スコア+講評を保存(week_start で上書き)。**description にルーブリック全文+MECE契約を常駐** |
| `get_weekly_report` | read | 保存済みレポート1件(省略=最新)。再表示・前週参照に |
| `get_weekly_reports` | read | 保存済み一覧(limit)。**Claude が前週からの連続性を語るため**にも使う(スコア推移) |

- `save_weekly_report` の description に: ①週境界の定義 ②各ディメンションのルーブリックと素材の写像 ③スコア帯ラベル ④**MECE契約**(「headline=統合・各 note=その関心のみ・同じ事実を繰り返さない」)⑤包括性(食事/睡眠/トレ/からだ/来週を必ず1関心ずつ)。
- 冪等は `week_start` が自然キーなので `clientRequestId` 不要。返り値 `{ weekStart, created }`(GH 非対象ゆえ `ghPushed` 無し)。
- `index.test.ts` の登録contract(現31本→34本)を更新。

## 6. web(一覧・詳細・画像エクスポート)

体験は既存アプリに合わせて以下に決定(「あなたが考えれば良い」の委任に基づく):

- **エントリポイント**: Home。現状 Home 下部に「今週のまとめを画像に」(rolling 7日の即席シェア=`WeeklyReport.tsx`)がある。これは**残す**(別物=その場の共有)。隣に「**週次レポート**」導線を1つ足し、`/weekly-reports` の**一覧画面**へ。ボトムナビは5タブ固定なので増やさない。
- **一覧画面 `/weekly-reports`(`WeeklyReportsScreen` 新規)**: 週レンジ + `overall_score` + headline + ディメンション別スコアの小チップを並べた**カードリスト**(新しい週が上)。空状態は「レポートはトレーナーAIとの会話で作成されます」(アプリは生成しない旨)。
- **詳細 + 画像エクスポート**: カードタップ → 詳細。**既存 `ShareImageModal`(html-to-image `toPng`、tone='bold')を再利用**し、`WeeklyReport.tsx` と同じ密度設計で MECE レイアウト(スコアのレーダー/バー + 5関心の note + snapshot の主要数値 + 来週フォーカス)。「画像に」ボタンで PNG ダウンロード。
- API: `/api/weekly-reports`(一覧)、`/api/weekly-reports/:weekStart`(詳細)。read のみ(生成は MCP 専用)。`api-types.ts` に `WeeklyReport` 型を追加。

## 7. 生成フロー(全て Claude 駆動)

1. オーナーが Claude に「今週の振り返りして」/ Claude が日曜会話で自発。
2. Claude が `get_week_review_data`(直近完了週)で決定的素材を取得。必要なら `get_day`/`get_exercise_history` 等で深掘り、`get_weekly_reports` で前週と比較。
3. Claude が description のルーブリックでスコアを写像し、MECE で5関心 + 総評 + 来週フォーカスを書く。
4. `save_weekly_report` で保存(サーバが `metrics_json` を凍結)。
5. オーナーはアプリの一覧/詳細で閲覧、画像エクスポートで共有。

## 8. やらないこと(規律)

- **アプリ/cron でのレポート生成をしない** — 生成は MCP(Claude)専用(オーナー要件)。
- **プロアクティブ通知を出さない** — D1 決定。日曜に自動で作って push、はしない。
- **GH へ同期しない** — GH が持てない語り系データ。
- **スコアを全て LLM 任意に委ねない** — 測れる下位指標は `get_week_review_data` が決定的に出し、Claude は規定写像で整える(实测主義)。
- **講評を自由 JSON 1カラムにしない** — MECE を列構造で強制。
- **rolling 7日の既存シェア(`WeeklyReport.tsx`)を置換しない** — 即席共有として残し、AI 週次レポートは別アーカイブとして共存。

## 9. 実装タスク(承認後)

1. migration `0020_weekly_reports.sql`(+ `db:apply:local`/`remote`)。
2. core: `weekly-report.ts`(data pack / save / get / list)+ 週境界 util + `getWeeklySummary` 窓引数化 + vitest。
3. mcp: 4ツール登録 + ルーブリック description + contract テスト更新。
4. web: `/api/weekly-reports` 2本 + `WeeklyReportsScreen` + 詳細+`ShareImageModal` 再利用 + Home 導線 + `api-types`。
5. docs 昇格(design.md §0.5/§8.x、mcp-design.md catalog、README データ表に1行)。

## 10. オーナー確認ポイント(承認前に決めたい)

- (A) **スコア尺度**: ✅ **0-100 で確定**(2026-06-08)。各帯ラベルを description に固定。
- (B) **採点方針**: ✅ **ハイブリッドで確定**(2026-06-08)。測れる下位指標は決定的、写像と語りは Claude。
- (C) **ディメンション粒度**: training / nutrition / recovery / body / overall の5軸(提案デフォルト)。主観/メンタルは別軸にしない=主観データを持たない方針(P2 却下)と整合。
- (D) **再生成ポリシー**: 同一週の再保存は上書き(最新で置換)。版管理はしない(提案デフォルト)。
- (E) **一覧の置き場所**: Home からの導線 + `/weekly-reports` 専用画面(ボトムナビは増やさない)(提案デフォルト)。

> C/D/E は異議がなければ上記で実装する。

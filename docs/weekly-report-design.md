# 設計書: 週次レポート(トレーナーAI生成・MCP保存)【確定版 — 実装着手可】

> ステータス: **設計確定(2026-06-08)。実装着手可**。多レンズ設計レビュー(`weekly-report-design-review` workflow / 5レンズ・敵対的)で `implement-with-adjustments` 判定 → must-fix 全反映済み。
> 確定事項: スコア尺度=**0-100** / 採点=**Claude がルーブリックで写像**(オーナー選択。core 決定論案は不採用)/ **ヒアリング駆動**(Claude がユーザーに数問聞いてから作る)。
> 関連: `docs/design.md`(§0.5 charter / §8.5 単一書込み)、`docs/mcp-design.md`、`docs/nutrition-scoring-design.md`、`CLAUDE.md`、`README.md`。

## 0. 位置づけと charter 整合

週次レポート = **Claude の総合判断+講評+スコア**を、決定的メトリクスの snapshot と**ヒアリングで得た主観文脈**とともに D1 に保存したもの。

- **アプリは生成しない(cron 不採用)**。生成は 100% トレーナーAI(Claude)が MCP 経由。アプリは**保存・一覧・詳細・画像エクスポート**のみ。
- **通知しない(D1 決定)**。生成トリガはオーナーと Claude の自由会話。
- **GH 非同期**。`routines` と同じく D1 ローカルのみで `gh_sync_state` に**登録しない**(`entity_type` 拡張不要・cron `retryPendingPushes` 対象外)。`ghPushed` 概念なし=`WRITE_LOCAL`。

### 0.1 charter「偽の0-100スコアを出さない」との棲み分け(重要)
`enhancements.md §0` / 稼働中の `get_readiness` description は「偽の0-100合成スコアは出さない」と宣誓している。週次レポートは 0-100 スコアを**永続化する**が矛盾しない理由を明文化する:

> readiness の 0-100 禁止は「**アプリが合成判定スコアを権威的事実として出す**」ことへの禁止。週次スコアは「**Claude の主観的講評の要約値**=決定的下位指標に裏打ちされた語りの一部」であり、アプリが出す権威的事実ではない。よって表現形式が同じ 0-100 でも charter 区分が異なる。

実装時、`enhancements.md §0` と `get_readiness` description に「週次レポートのスコアは例外(Claude 講評の summary 値)」の相互参照を1行入れる。

## 1. 週の境界

- **JST 日曜 00:00 〜 土曜 24:00 の固定週**(前の完了週)。rolling ではない。
- `weekStart` = 日曜 `YYYY-MM-DD`(JST)、`weekEnd` = 土曜。**`weekEnd` は Claude に渡させず、サーバが `weekStart` から導出**(導出責務をサーバに集約)。
- **既定週 = 直近の“完了”週**(今日が属する週の1つ前の日〜土)。進行中(未完了)の週は既定で採点しない(§5 ガード)。

### 1.1 JST 曜日算出の off-by-one 厳守(blocker)
既存 `util/date.ts` に曜日関数は無い。Worker のローカル TZ は UTC のため、素朴な `new Date(jstStr).getDay()` は JST 日曜00:00=UTC 土曜15:00 で**1日ズレる**。必ず:
```ts
// epoch+9h した Date に getUTCDay() で JST 曜日を取る
const JST_OFFSET_MS = 9 * 3600_000;
function jstDow(dateStr: string): number {
  return new Date(Date.parse(`${dateStr}T00:00:00+09:00`) + JST_OFFSET_MS).getUTCDay();
}
```
- `lastCompletedWeekJst(): { weekStart, weekEnd }` … 今日(JST)の今週日曜を求め −7日=先週日曜、+6日=先週土曜。
- `weekBoundsSec(weekStart, weekEnd): { startSec, endSec }` … `startSec=Date.parse(`${weekStart}T00:00:00+09:00`)/1000`、`endSec=…T23:59:59+09:00`。**`getWeekReviewData` と `getWeeklySummary` で同じ境界式を共有**。
- `date.test.ts` に境界回帰必須: JST 日曜00:00直後 / 土曜23:59 / 月またぎ / 年またぎ / UTC で前日になる時間帯。

## 2. スキーマ(箱)— migration `0020_weekly_reports.sql`

```sql
-- トレーナーAI が生成・保存する週次レポート(D1 ローカル・GH 非同期・gh_sync_state 非登録)。
-- week_start(JST日曜)を自然キーにし「1週1レポート」を保証。再保存は ON CONFLICT で上書き(版管理しない)。
CREATE TABLE weekly_reports (
  week_start        TEXT PRIMARY KEY,                 -- JST 日曜 'YYYY-MM-DD'
  week_end          TEXT NOT NULL CHECK (week_end > week_start),

  -- スコア(0-100 整数。データ不足の観点は NULL=未採点。トレンド化のためスカラ列+範囲CHECK)
  overall_score     INTEGER CHECK (overall_score   IS NULL OR overall_score   BETWEEN 0 AND 100),
  training_score    INTEGER CHECK (training_score  IS NULL OR training_score  BETWEEN 0 AND 100),
  nutrition_score   INTEGER CHECK (nutrition_score IS NULL OR nutrition_score BETWEEN 0 AND 100),
  recovery_score    INTEGER CHECK (recovery_score  IS NULL OR recovery_score  BETWEEN 0 AND 100),
  body_score        INTEGER CHECK (body_score      IS NULL OR body_score      BETWEEN 0 AND 100),

  -- 講評(MECE: 各列=1関心。headline が統合、各 note は詳細。重複させない)
  headline          TEXT NOT NULL,
  training_note     TEXT,
  nutrition_note    TEXT,
  recovery_note     TEXT,
  body_note         TEXT,
  focus_next_week   TEXT,

  -- ヒアリングで得た主観文脈(Claude が会話から渡す一次情報。サーバは recompute 不能)。
  -- metrics_json(決定的)とは別カラム=権威を分離。**構造化シグナル/スコアの決定的入力にはしない**(§8/P2-5線引き)。
  subjective_context TEXT,                            -- ヒアリング要約の自由文(任意)

  -- 生成時点の決定的メトリクス snapshot(画像レンダリング・再現性・後のデータ編集に不変)。
  -- schema_version と sensingProvenance/as_of を内包(主観は混ぜない)。
  metrics_json      TEXT NOT NULL,

  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
-- ※ idx は張らない: week_start が PK=一意インデックス自動生成、ORDER BY week_start DESC は逆走査で賄える(sync_runs 同様)。
```

設計判断:
- **スカラ・スコア列**=週次トレンドを引ける(将来「スコア推移」)。**講評は関心別の列**=MECE を構造で強制。**snapshot 凍結**=当時の事実のまま。
- **`subjective_context` は metrics_json と別カラム**: 主観は Claude が会話から渡す一次情報でサーバが再計算できない → 決定的 snapshot に混ぜると権威の取り違え(P0 規約: snapshot の権威はサーバ)。
- **upsert セマンティクス**(§4 で実装): `INSERT ... ON CONFLICT(week_start) DO UPDATE SET …=excluded.…, updated_at=unixepoch()`。**`created_at` は更新句から除外**(初回時刻保全)。`INSERT OR REPLACE` は使わない(行削除→再挿入で created_at が飛ぶ)。SQLite の DEFAULT は INSERT 時のみ発火するので updated_at は明示 SET。
- **`created` 判定**: 更新前に SELECT 存在確認(D1 は単一 batch のみ原子性=§8.5。1 statement upsert に収める)。

### 2.1 Zod モデル(`domain/models.ts` に追加)
`client.ts` の `parseOrThrow` が全 SELECT 行を safeParse する規約に従う。
- `WeeklyReport`(行): `week_start:IsoDate, week_end:IsoDate, overall_score:z.number().int().nullable() …(4軸), headline:z.string(), *_note:z.string().nullable(), focus_next_week:z.string().nullable(), subjective_context:z.string().nullable(), metrics_json:z.string(), created_at/updated_at:Unix`。
- `WeekReviewData`(metrics_json の中身): §4 のデータパック形を Zod 定義。`schema_version:z.number()` を持つ。保存時 stringify・読出時 parse の二層(`MealPreset.items_json` の前例に倣う)。

## 3. スコアリング・ルーブリック(`save_weekly_report` の description 常駐 → 毎回同基準)

各ディメンション 0-100。**Claude が `get_week_review_data` の決定的素材を、description の固定ルーブリックで写像**する。再現性を上げるため**閾値表/区分線形まで description に落とす**(定性表現で済ませない)。

### 3.1 各ディメンション(素材 → 0-100 の写像)
| 軸 | 決定的素材(data pack) | 写像(description に数値で固定) |
|---|---|---|
| **training** | landmark_zone 分布(**5帯**: under/building/optimal/high/over の部位数。null 部位=ガイドライン未設定で**分母から除外**)、セッション数、PR件数 | `optimal+high=充足 / building+under=不足 / over=過剰`。充足部位割合 r → 基礎点 `round(40+50*r)`、PR・セッション頻度で ±。over 多発は減点 |
| **nutrition** | 各日 `get_nutrition_score` の `avgDayScore0to1`(母数=採点できた日 `scoredDays`)、`daysLogged/7`、`dominantPhase` | `round(avgDayScore0to1*100)` を一貫性係数で減点(`daysLogged<4 → ×0.8`)。**記録ゼロ日は平均に含めない**(一貫性は daysLogged で別途表現) |
| **recovery** | 平均睡眠時間/効率、readiness の `{green,yellow,red,learning,noData}` 日数(母数=評価できた日)、HRV/RHR 逸脱 | green 寄り+睡眠充足ほど高。`red≥3日` は減点。learning/欠損日は分母から除外 |
| **body** | **週内 deltaKg**(`getWeeklySummary` の startKg/endKg=固定窓で整合)、補助として rolling28d の estimatedTdee/トレンド(`as_of` 付き・文脈) | フェーズ目標レンジ内の変化ほど高(cut=狙い通り減/bulk=制御された増/maintain=安定)。**phase 未設定 or 体重データ不足は NULL** |
| **overall** | 上記4軸 | 規定加重 training0.30/nutrition0.30/recovery0.25/body0.15。**NULL 軸は加重から除外し残りで再正規化**。致命ゲート: `記録0日≥4日 or red≥3日` で上限60 |

- スコア帯ラベル(description に固定): `85-100 優秀 / 70-84 良好 / 50-69 要改善 / <50 立て直し`。
- **NULL(未採点)と低スコア(実績不足)を弁別**: data pack は各軸に `hasData/sampleSize`(母数)を返す。母数0=NULL、母数>0かつ低=低スコア。トレンド集計は NULL を欠損として除外。

### 3.2 主観を採点に持ち込まない統制(实测主義 / P2-5 線引き)
- **スコアの一次根拠は決定的素材**(readiness/睡眠/landmark/体重 等の数値)。
- ヒアリングで得た主観(痛み・故障・生活ストレス・遵守理由・狙い)は **`recovery_note`/`body_note`/`headline`/`focus_next_week` の語りに織り込む**。
- 主観で recovery/body 等のスコアを動かす場合は**そのディメンションの note に「本人申告の◯◯を踏まえ…」と理由を必ず明示**(入力=主観 と 出力=講評/スコア の混線・恣意を監査可能にする)。これを description の MECE 契約に1項として書く。
- 主観を**構造化シグナルや readiness 信号にはしない**(=却下した P2-5 の裏口を作らない。§8)。

## 4. core(`packages/core/src/services/weekly-report.ts` ほか・新規/改修)

単一書込みパス(§8.5)に従い生 SQL は services/repository に閉じる。

### 4.1 固定 Sun–Sat 窓を出すための既存集計の改修(「小リファクタ」ではない・blocker)
| 関数 | 現状 | 改修 |
|---|---|---|
| `getWeeklySummary` | 既に `start/end/startSec/endSec` を取る(rolling は `*Now` ラッパのみ) | **そのまま固定窓で使える**(改修不要) |
| `getMuscleVolume` | `since=jstDaysAgo(windowDays-1)` + `today=todayJst()` 固定。decay/stimulus 正規化も today 基準 | **`endDate?` を追加**。`since=end-(windowDays-1)`、decay 基準・正規化も `end` に統一(既定 `todayJst()` で現行互換) |
| `getMuscleLoadRatios` | `jstDaysAgo(27/6)` 固定 | **`endDate?` を追加**(過去週 ACWR 用) |
| readiness 週次 | `getReadiness(db, date)` は単日1件のみ。多日集計なし | **新規**: weekStart..weekEnd の各日 `getReadiness` を呼び `{green,yellow,red,learning,noData}` 日数を集計。各日 signal は end-75d ベースライン依存の経路依存量である点に注意。終盤日は `gh_provisional` を別途返す |
| `getNutritionStatus` | rolling28 固定 | body 文脈用。**`endDate?`** を追加(or 週内 delta は getWeeklySummary を一次にし TDEE は補助) |

> 既存テスト(getMuscleVolume の P0-1 effective_sets 等)を壊さないよう、`endDate` は**任意・既定 `todayJst()`** で後方互換にする。

### 4.2 weekly-report サービス
- `getWeekReviewData(ctx, weekStart?)`: 固定週の**決定的データパック**を返す。`weekStart` 省略時は `lastCompletedWeekJst()`。返り値に **`weekStart/weekEnd`、`isComplete`(weekEnd<=todayJst かつ 7日揃い)、`coverageDays`、`sensingProvenance`(終盤が gh_provisional か)**、§3 の各軸素材(母数 `hasData/sampleSize` 込み)、PR一覧、`schema_version`。**landmark 充足は `effective_sets` 基準(P0-1 規約)**で算出し、その旨をフィールド名/コメントに明示。
- `saveWeeklyReport(ctx, input)`: `week_start` upsert。**`weekEnd >= todayJst` は reject**(進行中週の確定保存を拒否)。サーバが保存時に `getWeekReviewData` を呼んで `metrics_json` を凍結(Claude はスコア+講評+`subjectiveContext` を渡す)。**再保存時の metrics_json は既定で再凍結せず維持**(`refreshSnapshot:true` 明示時のみ再取得)=「当時の事実のまま」原則を守る。返り値 `{ weekStart, created, provisionalSensing }`(echo として `subjectiveContext` も含め確認提示可能に)。
- `getWeeklyReport(ctx, weekStart?)` / `listWeeklyReports(ctx, limit?)`。

## 5. MCP ツール(4本追加・`apps/mcp/src/index.ts`)

| ツール | 種別 | 役割 |
|---|---|---|
| `get_week_review_data` | read | 指定週(省略=直近完了週)の決定的データパック。採点前に読む素材 |
| `save_weekly_report` | write(`WRITE_LOCAL`) | スコア+講評+主観文脈を保存(week_start で上書き) |
| `get_weekly_report` | read | 保存済み1件(省略=最新) |
| `get_weekly_reports` | read | 保存済み一覧(前週比較・連続性に) |

### 5.1 `save_weekly_report` の description(多段ヒアリング契約・blocker)
本コードベースは `delete_recent_log`(echo+confirm 二段)等、description 本文で多段契約を強制する文化があり長文 description が許容される。以下の骨子を埋め込む:
1. **順序の強制**: 「まず `get_week_review_data` を読め。決定的素材なしに採点・保存するな」
2. **ヒアリング段(中核)**: 「保存前に、この週について会話からまだ得られていない主観を簡潔に数問ヒアリングせよ: 週全体の手応え / 痛み・故障の有無と部位 / 生活ストレス / 睡眠の乱れ / 計画を遵守できた・できなかった理由 / 本人の狙い。**既に会話で語られた項目は再質問しない**(毎回全部聞くと鬱陶しい)」
3. **取り込みと統制**: 「聞き取った主観は `subjectiveContext` として渡し、`recovery_note/body_note/headline/focus_next_week` の語りに織り込め。**主観でスコアを動かす場合はその note に理由を明示**。スコアの一次根拠は決定的素材」
4. **既定週ガード**: 「`weekStart` 省略=直近の“完了”週(先週日〜土)。進行中の週はデータ未確定なので既定では採点しない。ユーザーが“今週”と言っても、明示指定が無ければ完了週を対象にすると一言断れ」
5. その後に**採点写像(§3 ルーブリック全文)・スコア帯ラベル・MECE 契約・包括性**(食事/睡眠/トレ/からだ/来週を必ず1関心ずつ)。
- `get_week_review_data` の description にも相互参照1行:「これは決定的素材のみ。痛み/ストレス/遵守理由などの主観は会話で別途ヒアリングして `save_weekly_report` に渡す」。
- 冪等は `week_start` 自然キーゆえ `clientRequestId` 不要。返り値 `{ weekStart, created, provisionalSensing, subjectiveContext }`。
- `index.test.ts` の登録 contract を **31 → 35** に更新。

## 6. web(一覧・詳細・画像エクスポート)

### 6.1 命名衝突の回避(major)
既存 `apps/web/src/ui/components/WeeklyReport.tsx`(Home の「今週のまとめを画像に」= rolling 7日の即席シェア)と新機能名が衝突。**既存を `WeekRecapImage.tsx`(component `WeekRecapImage`)へリネーム**し Home の import を更新。新機能側に `WeeklyReport*` 名前空間を確保(`WeeklyReportsScreen` / `WeeklyReportDetail` / `WeeklyReportImage` / `WeeklyReportCard`)。

### 6.2 導線・画面
- **Home**: rolling 即席シェア(`WeekRecapImage`)は残す(その場共有)。**直近レポートがあれば** `overall_score`+`headline` の**ミニカード**(GlanceCard 様式・タップで詳細へ)を出し発見性を上げる。**無ければ**控えめな「週次レポート」リンク。文言で役割差を明示(「今週のまとめ(その場共有)」/「AI週次レポート(履歴)」)。ボトムナビ5タブは増やさない。
- **一覧 `/weekly-reports`**: 週レンジ + `overall_score` + headline + 4軸スコアの小チップのカードリスト(新しい週が上)。空状態:「レポートはトレーナーAIとの会話で作成されます。Claude に『今週どうだった?』と聞くと作成されます」。
- **詳細 + 画像**: `ShareImageModal`(html-to-image `toPng`、**tone='paper'**=高密度 MECE のテキスト主体レポートは濃赤背景の bold より paper の方が可読、という実装判断)再利用。

### 6.3 画像化の制約(major)
- recharts 流用時は**固定高さの親 div + `isAnimationActive=false`**(`NutritionScoreChart` の html-to-image 実績パターン)を必須要件にする。
- **画像にはスコア(レーダー/バー)+ headline + 各 note の要点1行 + 来週フォーカス + snapshot 主要数値**に限定。長文 note 全文は**画面側のみ**(CSS `line-clamp`)。
- **NULL 軸**はレーダーで 0 ではなく「—/未採点」グレー描画(`ConditionGlance` の偽スコアを出さない作法に揃える)。帯ラベル色は既存 `SIGNAL_STYLE`(#2f9e6e/#c98a2b/#e0521f)流用。

### 6.4 画像が依存する snapshot フィールド表(`metrics_json` = WeekReviewData)
最低限以下を固定(api-types の `WeeklySummary` を土台に `WeekReviewData`/`WeeklyReport` 型を派生):
- `training{sessions, volumeKg, prs, landmarkZones:{under,building,optimal,high,over}}`
- `nutrition{avgDayScore, daysLogged, avgKcal, avgP, avgF, avgC}`
- `recovery{avgSleepMin, avgEfficiency, readinessDays:{green,yellow,red}, avgHrv, avgRhr}`
- `body{startKg, endKg, deltaKg, estimatedTdee, phase}`
- `scores{overall, training, nutrition, recovery, body}`、`weekStart/weekEnd`、`sensingProvenance`、`schema_version`

### 6.5 API
- `/api/weekly-reports`(一覧=**軽量**: week_start/week_end/overall+4軸/headline のみ。metrics_json 除外でペイロード軽量化)。
- `/api/weekly-reports/:weekStart`(詳細=note 全文 + **パース済み** metrics オブジェクト)。
- 全 route 規約どおり `provenance:'d1_confirmed'` を付与。`api-types.ts` に `WeeklyReportSummary`(一覧)/ `WeeklyReport`(詳細)の2型。

## 7. 生成フロー(全て Claude 駆動)

1. オーナーが Claude に「今週(or 先週)の振り返りして」/ Claude が日曜会話で自発。
2. Claude が `get_week_review_data`(省略=直近完了週)で決定的素材を取得。`get_weekly_reports` で前週と比較。
3. **(中核)Claude が、決定的データで見えない主観を数問ヒアリング**(手応え/痛み・故障/生活ストレス/睡眠の乱れ/遵守理由/狙い。既に会話で出た項目は聞かない)。
4. ルーブリックでスコアを写像し、MECE で5関心+総評+来週フォーカスを書く(主観は講評に織り込み、スコア改変時は note に理由明示)。
5. `save_weekly_report` で保存(サーバが metrics_json 凍結、weekEnd 未来は reject)。
6. オーナーはアプリの一覧/詳細で閲覧、画像エクスポートで共有。

## 8. やらないこと(規律)

- アプリ/cron 生成しない / プロアクティブ通知しない / GH 同期しない(gh_sync_state 非登録)。
- **主観を構造化シグナル/readiness 信号/スコアの決定的入力にしない**。ヒアリングした主観は**講評(自由文)に織り込み `subjective_context` に永続化**するが、別スコア軸や readiness への合成はしない(=却下した P2-5 と整合。score の決定的入力にした瞬間に实测主義違反かつ P2-5 裏口)。
- スコアを core で決定論算出しない(オーナー選択=Claude 写像)。代わりに description のルーブリックを閾値表まで具体化して再現性を担保し、§0.1 の charter 棲み分けを明記。
- rolling 7日の即席シェア(`WeekRecapImage`)を置換しない(共存)。版管理しない(同一週は上書き)。

## 9. 実装タスク(依存順)

1. `migration 0020_weekly_reports.sql`(+ `db:apply:local`)。
2. core: `util/date`(`lastCompletedWeekJst`/`weekBoundsSec`)+ 境界テスト。集計の `endDate` 対応(getMuscleVolume/getMuscleLoadRatios/getNutritionStatus)+ readiness 週次集計。`weekly-report.ts`(data pack/save/get/list)。`models.ts`(WeeklyReport/WeekReviewData)。repository。vitest。
3. mcp: 4ツール + 多段ヒアリング description + contract 35。
4. web: 命名リネーム(WeekRecapImage)→ `/api/weekly-reports` 2本 + api-types + 一覧/詳細 + ShareImageModal 再利用 + Home 導線。
5. docs 昇格(design.md §8.x、mcp-design.md catalog、enhancements.md §0 と get_readiness の charter 相互参照、README データ表に1行)。
6. typecheck/lint/test → 実装差分の多次元レビュー(workflow)→ commit → **`db:apply:remote`(★migration あり)** → main マージ → web+mcp deploy → push → MCP smoke。

## 10. 確定済み決定

- (A) スコア尺度=**0-100**。(B) 採点=**Claude がルーブリックで写像**(core 決定論は不採用)。(C) ディメンション=training/nutrition/recovery/body/overall の5軸。(D) 同一週再保存=上書き(版管理なし)。(E) 一覧=Home 導線+`/weekly-reports` 専用画面。(F) **ヒアリング駆動**(§5.1/§7)。(G) 主観は `subjective_context` に永続化するが**構造化・スコア決定入力にはしない**(§3.2/§8)。

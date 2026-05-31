# 調査付録(設計書の根拠データ)

`docs/design.md` の根拠となった並列調査エージェント5本の生出力。
作成: 2026-05-31 / マルチエージェントワークフロー `gh-sidecar-design`。

---
# research:gh-api

I have enough to write a thorough, well-cited design-doc section. The write-availability nuance (release notes confirm exercise/weight/body-fat/sleep write since 3/24, nutrition-log + hydration data types added 5/26 with writeonly scope existing, but the codelab/data-types page lists nutrition-log as writable while Terra's older guide claims write isn't granted) is the key "confirmed vs needs-verification" tension I'll surface explicitly.

Let me compile the final deliverable.

---

# Google Health API v4 / Fitbit Web API 最新制約 調査結果（2026-05-31時点）

本ドキュメントは google-health-sidecar の設計判断に直結する API 制約を、一次情報（developers.google.com/health、dev.fitbit.com、release notes）で検証・補強したもの。**【確定】＝公式リファレンス/リリースノートで明記、【要実機検証】＝ドキュメント間に矛盾あり or 未記載、【推測】＝根拠からの推論**、を各主張に付す。

---

## 0. エグゼクティブサマリ（設計に効く結論）

1. **GH API v4 には筋トレの「セット×レップ×重量」を保持するフィールドが存在しない【確定】。** Exercise メッセージにあるのは `interval` / `exercise_type`(`STRENGTH_TRAINING`,`WEIGHTLIFTING` あり) / `metrics_summary`(kcal・距離・歩数・心拍など) / `splits` / `exercise_events`(start/stop/pause のみ) / metadata の `display_name`・`active_duration`・`notes`(自由記述) だけ。reps/sets/load/resistance フィールドはパッケージ全体を grep しても 0 件。→ **本アプリの筋トレ詳細(種目・部位・セット・重量・レップ)はこのアプリの D1 が source of truth であるべき**で、GH へは要約(種別・所要時間・消費カロリー・notes に圧縮した文字列)だけ書く設計が現実的。
2. **書き込みデータの正準単位は固定。** 体重=`weight_grams`(double, グラム)、栄養エネルギー=`kcal`(double)、栄養素重量=`grams`(double)、水分=`milliliters`。**kg/ポンド両表示(要件8)は完全にクライアント側の表示責務**で、API には kg もポンドも保存されない(`user_provided_unit` は付帯情報のみ)。
3. **栄養素表現は Fitbit より圧倒的にクリーン【確定】。** `Nutrient` enum に PROTEIN / CARBOHYDRATES / TOTAL_FAT(専用フィールド) / DIETARY_FIBER / SODIUM / SUGAR / CHOLESTEROL / 各種ビタミン・ミネラルが揃う。**Fitbit でやっていた「PFC が calories に潰れるので KV に meal preset を持つワークアラウンド」は GH では原理的に不要になる**（ただし下記 §1 の "identified vs anonymous food" の制約に注意）。
4. **OAuth 同意画面は必ず "In production" に publish する【確定】。** Testing のままだと refresh token が 7 日で失効し無人 Worker が壊れる。production なら無期限(6か月未使用 or revoke で失効)。単一ユーザーは未verified-production(100ユーザー上限)のままで CASA 不要【確定】。
5. **新規構築は GH API v4 直行を推奨【推測/判断】。** Fitbit Web API は 2026-09 停止確定で、いま Fitbit に作るのは数か月後に作り直す負債。ただし API は "actively evolving"(GA未到達、直近5/26にも破壊的変更)なので、**Provider 抽象は維持しデフォルトを `GoogleHealthProvider` にする**。
6. **要実機検証の最大の不確実性**: nutrition-log / hydration の**書き込みが第三者クライアントに実際に grant されているか**。リリースノートとデータ型ページは「writable」「nutrition-log 追加(5/26)」「writeonly スコープ存在」を示すが、第三者ガイド(Terra)は「write スコープはまだ第三者に grant されない / nutrition data type ID が受理されない」と矛盾。**着手初日に OAuth Playground で `nutrition.writeonly` を取り、`nutrition-log` への create を1発撃って確認すること。**

---

## 1. 書きたいデータの create/patch/batchDelete（食事・運動・体重）

### 1.1 共通: エンドポイント形状【確定】
全データ型が汎用リソース `users.dataTypes.dataPoints` に集約。`userId` は `me`。

| 操作 | HTTP | パス |
|---|---|---|
| create | POST | `/v4/users/me/dataTypes/{dataType}/dataPoints` |
| get | GET | `/v4/users/me/dataTypes/{dataType}/dataPoints/{id}` |
| list | GET | `/v4/users/me/dataTypes/{dataType}/dataPoints` |
| patch | PATCH | `/v4/users/me/dataTypes/{dataType}/dataPoints/{id}` |
| batchDelete | POST | `/v4/users/me/dataTypes/{dataType}/dataPoints:batchDelete` |
| reconcile | POST(リファレンス) / GET(endpointsページ) **【要実機検証: 矛盾】** | `.../dataPoints:reconcile` |
| rollUp / dailyRollUp | POST | `.../dataPoints:rollUp` / `:dailyRollUp` |
| exportExerciseTcx | GET | `.../dataPoints/{id}:exportExerciseTcx` |

出典: [users.dataTypes.dataPoints (REST)](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints) / [Endpoints](https://developers.google.com/health/endpoints)

DataPoint 共通フィールド: `name`(識別子) / `dataSource`{`recording_method`, `device`, `application`(output only), `platform`(output only)} / data(union)。**手入力データは `dataSource.recording_method = "MANUAL"` を付ける**(enum: `MANUAL` / `PASSIVELY_MEASURED` / `DERIVED` / `ACTIVELY_MEASURED` / `UNKNOWN`)【確定】。

create 例(body-fat、公式 Endpoints ページから verbatim):
```json
POST /v4/users/me/dataTypes/body-fat/dataPoints
{ "name":"bodyFatName", "dataSource":{"recordingMethod":"ACTIVELY_MEASURED",
  "device":{"formFactor":"SCALE","manufacturer":"Scales R Us","displayName":"HumanScale"}},
  "bodyFat":{"sampleTime":{"physicalTime":"2026-03-10T10:00:00Z"},"percentage":20}}
```

### 1.2 食事(nutrition-log)【確定 + 一部要実機検証】
- dataType ID: `nutrition-log`(5/26 追加、writable)。スコープ `…/auth/googlehealth.nutrition.writeonly`。出典: [Data types](https://developers.google.com/health/data-types) / [Scopes](https://developers.google.com/health/scopes) / [Release notes 2026-05-26](https://developers.google.com/health/release-notes)
- **NutritionLog の2つの作り方【確定・設計の肝】**(RPC リファレンス verbatim):
  - **Identified food**: `food`(Food ID 文字列)を参照。`nutrients`/`energy`/`total_carbohydrate`/`total_fat`/`food_display_name` が参照先 Food から自動補完。**編集可能。**
  - **Anonymous food**: `food_display_name` + `nutrients` ほかを手動セット。**"Nutrition logs created from anonymous food are not editable"**(patch 不可)。
  - 注意: `food` フィールドは reference 上 **"Required. Represents the food ID."** と書かれている一方、Anonymous food では `food_display_name` 経路が使える、という記述と緊張する → **手入力 PFC を editable に保つには Food リソースを引けるか、それとも anonymous で immutable を受け入れるかは要実機検証。** 出典: [RPC: NutritionLog](https://developers.google.com/health/reference/rpc/google.devicesandservices.health.v4)
- フィールド: `interval`(必須) / `nutrients[]`(`NutrientQuantity`={`quantity`:WeightQuantity, `nutrient`:Nutrient enum}) / `energy`(EnergyQuantity) / `energy_from_fat` / `total_carbohydrate`(WeightQuantity) / `total_fat`(WeightQuantity) / `meal_type` / `serving` / `food` / `food_display_name`【確定】
- `Nutrient` enum(抜粋): PROTEIN, CARBOHYDRATES, TOTAL_FAT, MONOUNSATURATED_FAT, POLYUNSATURATED_FAT, SATURATED_FAT, TRANS_FAT, DIETARY_FIBER, SODIUM, SUGAR, CHOLESTEROL, POTASSIUM, CALCIUM, IRON, CAFFEINE, ビタミンA/B/C/D/E/K 等【確定】
- `EnergyQuantity` = `kcal`(double, 必須) + `user_provided_unit`(任意, enum: KILOCALORIE/CALORIE/JOULE/KILOJOULE/SMALL_CALORIE)
- `WeightQuantity` = `grams`(double, 必須) + `user_provided_unit`(任意, enum: GRAM/KILOGRAM/OUNCE/POUND)
- `MealType` enum: MEAL_TYPE_UNSPECIFIED / BREAKFAST / LUNCH / DINNER / SNACK ← **Fitbit の6種(Breakfast/MorningSnack/Lunch/AfternoonSnack/Dinner/Anytime)から縮退**。MorningSnack/AfternoonSnack/Anytime のマッピングを要設計(全部 SNACK に寄せる等)。

**Fitbit との差**: Fitbit Create Food API は calories しか保存せず PFC が silent drop → KV preset で回避していた。GH は `nutrients[]` で PFC・繊維・ナトリウム等を**ネイティブに保持**。**ただし** PFC を後から編集したいなら identified food が必要で、anonymous は immutable。**設計推奨**: D1 にアプリ独自の「食事マスタ(自作プリセット)」を持ち、ログ作成時に GH へ書く。GH 側 immutable 問題を避けるため「修正＝batchDelete + 再create」を基本フローにすると堅い。

### 1.3 運動(exercise)【確定】
- dataType ID: `exercise`(writable, 3/24 から)。スコープ `…/googlehealth.activity_and_fitness.writeonly`。出典: [Release notes 2026-03-24](https://developers.google.com/health/release-notes)
- Exercise フィールド: `interval`(SessionTimeInterval, 必須) / `exercise_type`(必須) / `metrics_summary`(必須) / `splits[]` / `exercise_events[]` / `exercise_metadata`{`display_name`(必須), `active_duration`, `notes`(自由記述), create/update_time(output)}【確定】
- `exercise_type` enum に **`STRENGTH_TRAINING`, `WEIGHTLIFTING`, `WORKOUT`, `HIIT`, `YOGA`, `PILATES`, `RUNNING`, `WALKING`, `CYCLING`, `SWIMMING`** 等あり【確定】
- `metrics_summary`(`MetricsSummary`): `calories_kcal`, `distance_millimeters`, `steps`, `average_speed_millimeters_per_second`, `average_pace_seconds_per_meter`, `average_heart_rate_beats_per_minute`, `elevation_gain_millimeters`, `active_zone_minutes`, `run_vo2_max`, `total_swim_lengths`, `time_in_heart_rate_zones`, `mobility_metrics`【確定】
- `exercise_events[]` の type は **START/STOP/PAUSE/RESUME/AUTO_PAUSE/AUTO_RESUME のみ**(セット区切りには使えない)【確定】
- **筋トレ詳細(sets/reps/weight/load/resistance)を保持するフィールドは API 全体に存在しない【確定: grep で 0 件】。**

**Fitbit との差 & 設計上の最重要結論**: Fitbit の log_activity も同様に詳細セット情報を持たなかった。GH でも本質は変わらない。→ **筋トレのセット/レップ/重量/部位は本アプリの D1 が authoring 元 & source of truth。** GH には「種目(STRENGTH_TRAINING)・所要時間・推定消費kcal・`notes`にサマリ文字列(例: `"Bench 60kg×8×3; Squat 80kg×5×5"`)」を書いて健康エコシステム連携用の足跡を残す、という二層構成を推奨。これは要件3(完全自分用)・要件7(部位ヒートマップ)とも整合的で、人体ヒートマップに必要な「種目→部位」プリセットも当然 D1 側に持つ。

### 1.4 体重(weight)【確定】
- dataType ID: `weight`(writable, 3/24 から)。スコープ `…/googlehealth.health_metrics_and_measurements.writeonly`。
- Weight フィールド: `sample_time`(ObservationSampleTime, 必須) / `weight_grams`(double, 必須) / `notes`(任意)【確定】
- body-fat も同バンドル(`body-fat`, percentage)【確定】
- **kg/ポンド両表示はクライアント計算**(`weight_grams` ÷ 1000 = kg、× 0.00220462 = lb)。

---

## 2. 読みたいデータの daily batch（体重・睡眠・歩数・心拍・HRV・SpO2・VO2max）

### 2.1 list の使い方【確定】
`GET /v4/users/me/dataTypes/{dataType}/dataPoints`
- `pageSize`: 既定 1440、**exercise/sleep は既定25・上限25**、その他上限10,000(超過は truncate)
- `pageToken`: 前回レスポンスの `nextPageToken`
- `filter`: AIP-160 構文。時間範囲は data type 形状で変わる:
  - interval系: `{dataType}.interval.start_time` または `civil_start_time`
  - sample系: `{dataType}.sample_time.physical_time` または `civil_time`
  - daily系: `{dataType}.date`
  - 物理時刻は RFC-3339(`2023-11-24T00:00:00Z`)、civil は `2023-11-24` or `2024-08-14T12:34:56`。比較演算子 `>=`,`<`、論理 `AND`/`OR`(`OR` は sleep限定)
- レスポンス: `{ "dataPoints":[...], "nextPageToken":"" }`。**interval start 降順。**

出典: [list method](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list)

### 2.2 :list vs :reconcile【確定 + 第三者補強】
- **:list** = 生データポイント(device/manual、source attribution 付き)。複数デバイス(Pixel Watch + Sense)の重複は自分で dedupe。
- **:reconcile** = Google 側が突合済みの単一ストリーム。provenance 無し。**daily batch で「最終的な1日の値」を取るなら reconcile が楽**(体重・睡眠・歩数の表示用)。デバイス出所が要るとき(複数デバイス検証等)だけ list。
- **dailyRollUp / rollUp** = 日次集計(resting HR・HRV personal range・歩数合計などの「daily-」型と相性)。

出典: [Terra guide](https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api) / [reconcile/list (REST)](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints)

### 2.3 読み取り対象 dataType ID(本アプリの daily batch 候補)【確定】
| 目的 | dataType ID | スコープ(readonly) | 備考 |
|---|---|---|---|
| 体重 | `weight` | health_metrics…readonly | 表示・体組成トレンド |
| 体脂肪 | `body-fat` | health_metrics…readonly | |
| 睡眠 | `sleep` | sleep.readonly | stages 対応 |
| 歩数 | `steps` | activity_and_fitness.readonly | read-only |
| 安静時心拍 | `daily-resting-heart-rate` | activity_and_fitness.readonly | daily型→dailyRollUp |
| 心拍(連続) | `heart-rate` | activity_and_fitness.readonly | intraday相当(下記注意) |
| HRV | `heart-rate-variability` / `daily-heart-rate-variability` | activity_and_fitness.readonly | RMSSD直接対応 |
| SpO2 | `oxygen-saturation` / `daily-oxygen-saturation` | health_metrics…readonly | |
| VO2max | `vo2-max` / `daily-vo2-max` / `run-vo2-max` | activity_and_fitness.readonly | cardio fitness 相当 |
| アクティブカロリー | `active-energy-burned` | activity_and_fitness.readonly | 5/26追加 |
| AZM | `active-zone-minutes` | activity_and_fitness.readonly | |

出典: [Data types](https://developers.google.com/health/data-types)

**intraday の注意【確定】**: Fitbit の detailLevel(1sec/5min バケット)が無く、ネイティブ ~5秒サンプルを `dataPoints.list` + RFC3339秒精度 filter で取得してクライアント側ダウンサンプルが必要(ブリーフの確定事実を裏取り。`heart-rate` の sample 形状で確認)。**ただし daily batch 用途なら `daily-*` 型 + reconcile/dailyRollUp で十分**で、intraday を引く必要は基本ない(モバイル PWA で生5秒データを描画する要件は薄い)。

### 2.4 レート制限【要実機検証】
**GH API v4 のリクエスト毎時/毎分上限の数値は公式ドキュメントに未掲載**(about/endpoints/list いずれも数値なし)。OAuth クライアントは「unverified, 100ユーザー上限」だがこれは**ユーザー数上限であってリクエストレートではない**。`/health/endpoints` に "Rate limits" セクション参照が示唆されるが具体数なし。→ **daily batch は 1日1回・直列・指数バックオフ(429想定)で実装し、実機で 429 が出るか観測してから並列度を上げる。** 出典: [About](https://developers.google.com/health/about) / [Endpoints](https://developers.google.com/health/endpoints)

---

## 3. OAuth / 認可の実務（無人 Worker から refresh し続ける）

### 3.1 セットアップ【確定】
1. GCP プロジェクト作成 → Google Health API を有効化。出典: [Setup](https://developers.google.com/health/setup)
2. OAuth クライアント: **"Web Server"** タイプ、Authorized redirect URI に `https://www.google.com`(codelab 手動フロー用。実運用は自前 callback URL に置換)
3. **OAuth 同意画面を "In production" に publish(必須)。**
4. Data Access ページで必要スコープを明示選択(未選択だと API 呼べない)。

### 3.2 refresh token 長命化【確定・設計の生命線】
- **Testing 公開ステータス**: "refresh tokens issued are time-based and expire after 7 days" → **無人 Worker 即死**。出典: [Setup](https://developers.google.com/health/setup)
- **Production 公開ステータス**: "refresh tokens generally don't expire unless they are revoked or remain unused for a prolonged period"。一般 Google OAuth ポリシー上の失効条件は ①ユーザーが access 取消 ②**6か月未使用** ③Gmail スコープ含み+パスワード変更 ④付与live refresh token 上限超過 ⑤管理者が scope を Restricted 化。出典: [Setup](https://developers.google.com/health/setup) / [OAuth2 Policies](https://developers.google.com/identity/protocols/oauth2/policies)
- 本アプリは毎日 batch で refresh を回す → **6か月未使用には絶対に当たらない**。単一ユーザーなので "live refresh token 上限" にも当たらない。

### 3.3 verification / CASA 不要条件【確定】
- 新規 OAuth クライアントは "unverified state with a cap of 100 users for both testing and production"。**100ユーザー以下なら unverified-production のまま運用可。**
- "Supporting more than 100 users with the Google Health API requires completion of a third party security review"(= CASA)。
- **本アプリはユーザー1人 → CASA 不要、未verified-production で長命トークン可【確定】。** 出典: [Setup](https://developers.google.com/health/setup)

### 3.4 Cloudflare Worker からの落とし穴
- **`include_granted_scopes=true` を使わない【確定・重要】**: legacy `fitness.*` スコープが token に union されると「GH data plane が mixed-scope token を reject」する。出典: [Terra guide](https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api)
- **同時 refresh**: Google の refresh はトークンローテーション挙動が Fitbit と異なる可能性【要実機検証】。Fitbit は「2分以内の同一 refresh_token に同じ応答」だが Google は保証されていない。**無人 Worker では cron で逐次 refresh + KV ロック(or D1 トランザクション)で二重 refresh を防ぐ**のが安全。失効60s前に更新する既存方式は踏襲可。
- **トークン保管**: 既存は KV(TOKENS)。D1 化(要件1)するなら refresh token は D1 の secrets テーブル(暗号化推奨) or Workers Secrets/Secrets Store。単一ユーザーなので KV 1キーでも実害は小さい。
- **再 consent 必須**: Fitbit の access/refresh は GH へ移行不可。一度だけ Google OAuth を踏み直す(Pattern B、CLI で1回)。出典: [Migration](https://developers.google.com/health/migration)

### 3.5 スコープ一覧【確定】
6つの機能バンドル(Fitbit の15ドメインスコープから縮退)。**per-metric ではなくバンドル単位**:
- readonly: `activity_and_fitness` / `ecg` / `health_metrics_and_measurements` / `irn` / `location` / `nutrition` / `profile` / `settings` / `sleep`
- writeonly: `activity_and_fitness` / `health_metrics_and_measurements` / `nutrition` / `profile` / `settings` / `sleep`
- 形式: `https://www.googleapis.com/auth/googlehealth.<bundle>.<readonly|writeonly>`
- **全スコープ Restricted 分類**(privacy/security review 対象だが、100ユーザー未満は免除)。出典: [Scopes](https://developers.google.com/health/scopes) / [Terra guide](https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api)

**本アプリの最小スコープセット(推奨)**: write = `activity_and_fitness.writeonly`(exercise) + `nutrition.writeonly`(食事/水分) + `health_metrics_and_measurements.writeonly`(体重/体脂肪)。read = `health_metrics_and_measurements.readonly`(体重/SpO2) + `sleep.readonly` + `activity_and_fitness.readonly`(歩数/心拍/HRV/VO2max)。

---

## 4. 判断: 新規構築は Fitbit Web API か GH API v4 直行か

### 確定事実の整理
| 観点 | Fitbit Web API | GH API v4 |
|---|---|---|
| 寿命 | **2026-09 完全停止**(残り約3か月) | 後継・継続 |
| 現状(5/31) | dual-run でまだ稼働 | 稼働中だが GA未到達、"actively evolving" |
| 安定性 | 枯れている(が EOL) | 直近5/26にも破壊的変更(scope分割) |
| 書き込みのクリーンさ | 食事 PFC が silent drop → KV preset 必須 | nutrients[] でネイティブ保持(identified food なら editable) |
| トークン移行 | — | Fitbit token は移行不可、再consent必要 |

出典: [About](https://developers.google.com/health/about) / [Release notes](https://developers.google.com/health/release-notes) / [Migration](https://developers.google.com/health/migration)

### 判断【推測/設計判断】
**GH API v4 直行を推奨。** 理由:
1. Fitbit に作ると 3か月後に必ず作り直し(token 移行不可なので二度手間が確定)。新規プロダクトに EOL API を採る合理性が無い。
2. 食事の書き込みが GH では構造的にクリーン(KV preset ワークアラウンド廃止 = 既存負債の解消)。要件「fitbit-googlehealth-mcp を廃止し本repoのMCPへ移行」とも一致。
3. 残る懸念は「GA未到達 + breaking change」だが、これは Provider 抽象 + 統合テスト + スキーマ(Zod)を薄く保つことで吸収できるリスク。

**ただし dual-run のセーフティネットは設計に織り込む**:
- 既存の `HealthProvider` インターフェース(read+write)を維持し、**デフォルト実装を `GoogleHealthProvider`** にする。
- `FitbitProvider`(既存)は**読み取り検証用・移行直後のフォールバック**として当面残置。GH の write が実機で grant されていない/壊れた場合に Fitbit へ一時退避できる退路。2026-09 直前に削除。
- 設定フラグ(env)で provider を切替可能に。

---

## 5. 既知の罠・未解決の不確実性（要実機検証リスト）

| # | 項目 | 状態 | 検証アクション |
|---|---|---|---|
| 1 | **nutrition-log / hydration の write が第三者クライアントに実 grant されているか** | リリースノート(5/26 追加・writable)とデータ型ページは肯定、Terra guide は「write scope は第三者に未grant」と否定 → **矛盾** | OAuth Playground で `nutrition.writeonly` 取得 → `nutrition-log` create を実行し 200/403 を確認(着手初日) |
| 2 | **identified food vs anonymous food** | anonymous は immutable(patch不可)が確定。だが `food`(Food ID)が Required 表記との緊張 | Food リソースを clients が引けるか、anonymous-only で運用可か実機確認。**当面は "編集＝delete+再create"** 前提で設計 |
| 3 | **筋トレ詳細の非保持** | **確定**(reps/sets/load フィールド皆無) | D1 を source of truth に。GH へは要約のみ。設計変更不要だが UI/データモデルに反映 |
| 4 | **reconcile の HTTP verb** | REST resource ページ=POST、endpoints ページ=GET で**矛盾** | 実機で両方試す。クライアントは生成 discovery doc に従う |
| 5 | **レート制限の数値** | **公式未掲載** | daily batch を直列+指数バックオフで実装、429 を観測してから調整 |
| 6 | **breaking change 頻度** | "actively evolving"、3〜5月で破壊的変更複数(scope分割等) | discovery doc を pin、CI で日次 smoke test、Zod スキーマで早期検知 |
| 7 | **Google refresh のローテーション挙動** | Fitbit と異なる可能性(未確認) | Worker 側で refresh ロック。production publish で7日失効を回避(必須) |
| 8 | **GH 消費者アプリ側の手入力 UX 後退** | リブランド v5.0 はモバイルのみ・Web dashboard 無し | 本 PWA が手入力 UX の主役になる前提は妥当(要件4/5を補強) |
| 9 | **MealType の縮退**(6→4) | 確定 | MorningSnack/AfternoonSnack/Anytime → SNACK へのマッピングを明示設計 |
| 10 | **アカウント統合期限** | 統合5/19完了、未統合は7/15データ削除。統合は Fitbit token を無効化しない | オーナーのアカウントが統合済みか確認(未統合なら7/15前に対応) |

出典: [Release notes](https://developers.google.com/health/release-notes) / [Terra guide](https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api) / [RPC reference](https://developers.google.com/health/reference/rpc/google.devicesandservices.health.v4) / [About](https://developers.google.com/health/about)

---

## 主要出典URL一覧
- https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints
- https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
- https://developers.google.com/health/reference/rpc/google.devicesandservices.health.v4
- https://developers.google.com/health/data-types
- https://developers.google.com/health/scopes
- https://developers.google.com/health/setup
- https://developers.google.com/health/endpoints
- https://developers.google.com/health/release-notes
- https://developers.google.com/health/about
- https://developers.google.com/health/migration
- https://developers.google.com/health/codelabs/make-your-first-api-call
- https://developers.google.com/identity/protocols/oauth2/policies
- https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api

---

### ブリーフ確定事実の検証結果サマリ
- ✅ 検証一致: 2026-09停止 / GH v4 base・package / dataPoints集約 / 5/26 scope分割(.readonly/.writeonly) / write解禁日(weight・body-fat・sleep・exercise=3/24、hydration・nutrition=5/26) / Pattern B生存 / production publish必須・7日失効 / CASA100ユーザー閾値 / intradayバケット無し→秒精度filter / アカウント統合5/19・未統合7/15削除 / 消費者アプリ手入力UX後退
- 🔧 補強・更新: **栄養素は専用 Nutrient enum で PFC含む詳細を保持可(Fitbit KV preset ワークアラウンド不要)** / **identified vs anonymous food で editable性が変わる(anonymousはimmutable)** / **筋トレ詳細(sets/reps/load)はAPIに保持不可=D1がSoT** / 体重は`weight_grams`正準(kg/lb表示はクライアント計算) / recording_method=MANUAL / `include_granted_scopes=true`禁止 / reconcile verb矛盾 / レート制限数値は未公開
- ⚠️ 要実機検証(最重要): nutrition/hydration write の第三者 grant 実態(release notes と Terra guide が矛盾)

---

# research:cloudflare

I have all the information needed. Now writing the comprehensive design doc.

# Cloudflare アーキテクチャ設計書 — Google Health Sidecar

対象: 単一ユーザー(tachibanayu24@gmail.com)専用のボディメイク用 sidecar アプリ。
基準日: 2026-05-31。
本書は当該コードベースを読めない「普段使いの Claude アプリ」がレビューする前提で、判断根拠・代替案・トレードオフ・未決事項を自己完結的に明記する。

---

## 0. エグゼクティブサマリ(結論先出し)

- **配信構成**: PWA(SPA) + REST API + MCP を **1つの Worker に同居**させ、静的配信は **Workers Static Assets**(Pages ではない)を採用。2026 年時点で Workers は Pages と機能パリティに達し、Cloudflare 公式が新規プロジェクトは Workers を推奨している([Workers static assets docs](https://developers.cloudflare.com/workers/static-assets/), [Pages→Workers migration](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/))。
- **ストレージ**: 食事/ワークアウト/種目マスタ/プリセット/体組成ミラーは **D1**(リレーショナル)。OAuth トークンと read キャッシュは **KV**。食事写真は基本 **R2 を使わない**(理由は §1.4)。
- **認証**: UI ログインは「Sign in with Google の ID トークン(OIDC)を JWKS 検証し、`sub`/`email` を1つに固定 → 署名付き JWT を HttpOnly Cookie に格納」。Google Health API アクセス用 OAuth は **別系統**として扱い、refresh token は KV に長命保管(同意画面を **In production** に publish して 7 日失効を回避)。
- **daily batch**: Cron Triggers で GH API から体重/睡眠/SpO2 等のセンシングデータを D1 へ **冪等 upsert**。`sync_state` テーブルで増分・重複防止。
- **MCP 同居**: 同一 Worker・同一 D1・同一 provider 層を UI と MCP で共有。Streamable HTTP(stateless)。保護は既存方式踏襲(URL 埋め込み secret + Anthropic CIDR allowlist)。
- **コスト**: 単一ユーザーなら **完全無料枠内**。唯一の注意点は **KV 無料枠の書き込み 1,000/日**(§1.3, §6.4 で対処)。

---

## 1. 構成要素の選定と役割分担

### 1.1 配信: Workers Static Assets に1 Worker 同居 vs Pages vs 分離

**採用: 1つの Worker に Static Assets + API + MCP を同居。**

```
                 ┌─────────────────────── Cloudflare Worker (単一) ───────────────────────┐
   Browser/PWA ─▶│  Static Assets binding(ASSETS)  … PWA(React等)を配信               │
   Claude.ai   ─▶│  Hono router                                                          │
   Cron        ─▶│   ├─ /api/*   REST(UIバックエンド)  ─┐                              │
                 │   ├─ /mcp     Streamable HTTP(MCP)  ─┼─▶ Provider層(GoogleHealth)  │
                 │   └─ scheduled() daily batch          ─┘        │                     │
                 │                                                  ▼                     │
                 │                            D1(SQL)  /  KV(token+cache)               │
                 └──────────────────────────────────────────────────────────────────────┘
```

ルーティングは Static Assets の `run_worker_first` で「API/MCP は Worker 優先、それ以外は静的アセット」を宣言的に分離する([static assets binding docs](https://developers.cloudflare.com/workers/static-assets/binding/))。

| 選択肢 | メリット | デメリット | 判定 |
|---|---|---|---|
| **1 Worker 同居(採用)** | provider 層・D1 バインディング・型・secret を UI/MCP/batch で完全共有。デプロイ1回。CORS 不要(同一オリジン)。Cookie 認証が素直 | Worker のコードが単一に集中(モノリス)。ただし単一ユーザー規模では問題にならない | ★採用 |
| Pages + Pages Functions | 従来定番 | 2026 年は Cloudflare が新規は Workers 推奨。新機能は Workers 先行。MCP/Cron との同居が Workers ほど素直でない | 非推奨(時代遅れ化) |
| フロント(Pages/Assets)と API/MCP(別 Worker)を分離 | 関心分離・独立デプロイ | CORS 設定、Cookie の SameSite/ドメイン設計が増える、provider 層の共有にパッケージ分割が必要。単一ユーザーに対し過剰 | 不採用 |

トレードオフ補足: 同居の最大リスクは「静的アセットのキャッシュ汚染や誤ルーティングで API/MCP が露出/壊れる」こと。これは `run_worker_first: ["/api/*", "/mcp"]` を明示し、`/api` 配下は必ず Worker が処理することで回避する。SPA フォールバックは `not_found_handling: "single-page-application"`。

### 1.2 D1(リレーショナル本体) — 採用

ワークアウト(セット/レップ/重量)、種目マスタ、筋部位、食事・食材明細、プリセット、体組成ミラーは明確にリレーショナルで、集計・期間検索・JOIN(種目→部位ヒートマップ)が必要。**D1 を本体ストレージとする。** 既存 MCP が D1 未使用で KV に preset を押し込んでいたのは Fitbit MCP の制約であり、本アプリでは正攻法で D1 を使う。

- 単一プライマリ書き込みモデル。書き込みは東京近傍リージョン(プライマリ配置を `asia` 寄りに)で低レイテンシ化できる([D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/))。
- read replication は単一ユーザーでは**不要**(オーバーエンジニアリング)。将来必要になったら Sessions API 導入で後付け可能。今は使わない。

### 1.3 KV(トークン + キャッシュ) — 採用、ただし書き込み制約に注意

- 用途: ① GH API の OAuth `access_token`/`refresh_token`、② GH API read 結果のキャッシュ(TTL 1h)。既存 MCP の `TOKENS`/`CACHE` 2 namespace 構成を踏襲。
- **重要な制約**: KV 無料枠は**書き込み 1,000 回/日**([KV pricing](https://developers.cloudflare.com/kv/platform/pricing/))。トークン refresh ごとに KV write が発生する素朴実装だと、リクエスト多発で枯渇しうる。
  - 対策: access_token は失効 60s 前のみ refresh(既存方式踏襲)。さらに **refresh 後のトークンは KV(永続) + Worker メモリ(同一 isolate 内 TTL キャッシュ)** の二層にし、KV read/write を最小化。
  - キャッシュ用途は D1 でも代替可能だが、TTL 失効が KV の方が自然なので KV 継続が妥当。
- なぜトークンを D1 でなく KV か: トークンは単一キーの読み書きで、TTL/低レイテンシ KV が適切。リレーショナルでもない。**役割分担として KV=揮発的KV、D1=構造化永続が自然。**

### 1.4 R2(食事写真の保存) — 原則不要(MVP では使わない)

判断: **MVP では R2 を採用しない。**

根拠:
- 食事ログの主役フローは「写真を Claude が視覚解析 → `items[]`(品名・PFC・kcal)に構造化 → D1 と GH API に登録」。**解析後に残すべきは構造化データであって、画像そのものは栄養計算に不要。**
- スマホ PWA からの登録は、画像をサーバーに永続保存せずクライアントで解析依頼に回せば、ストレージもプライバシーリスクも持たない。
- GH API も Fitbit も「食事写真そのもの」を栄養素として保存はしない。

代替/将来: 「あとで振り返るために写真を残したい」という要望が出たら R2 を追加(無料枠 10GB/月、egress 無料)。その場合 `meals.photo_r2_key` カラムを追加し、R2 オブジェクトキーだけ D1 に持たせる。**今はカラムだけ予約しておき、実体保存は後付け**にするのが堅牢かつ低コスト。

### 1.5 Durable Objects — 不要

理由: DO は「単一エンティティへの強整合な並行アクセス調停」が価値。本アプリは単一ユーザーかつ同時書き込み競合がほぼ無い。GH トークン refresh の競合も、GH/Fitbit は「2分以内の同一 refresh_token 要求に同一応答を返す」性質(既存 research 確定事項)があり同時 refresh が安全なため、DO によるロックは不要。**採用しない。** 将来「無人 batch とユーザー操作が同時にトークンを使う厳密制御」が必要になった時の代替候補として記憶に留める程度。

### 1.6 Queues — 原則不要(MVP)

理由: daily batch は Cron で同期的に回せば足りる(処理は1日分の GH read + D1 upsert、数秒)。非同期分散の必要がない。
将来: 「写真解析→複数 API 書き込み」を非同期に投げたい、もしくは GH API レート制限で再試行を分散したい場合に Queues を追加。MVP では Cron 内で逐次処理 + 失敗時リトライで十分。

### 1.7 Cron Triggers — 採用(daily batch の中核)

§4 で詳述。GH API からセンシングデータを引き、D1 にミラーする 1 日 1〜数回の起動。

### 1.8 Workers AI / 写真解析の所在 — 未決(§9 で論点化)

写真→PFC 構造化は「Claude(MCP 経由)」が担う前提だが、UI から直接登録する場合の解析主体(Workers AI のビジョンモデル vs Claude API 直叩き)は未決。MVP は MCP 経由(Claude.ai/Claude アプリが解析)で割り切る。

---

## 2. D1 スキーマ設計案(DDL)

設計方針:
- **重さは SI(kg)で保存、表示時に lb 変換**(`lb = kg * 2.2046226218`)。理由は §2.7。
- 単一ユーザーでも `user_id` 相当は持たせない代わりに、将来の堅牢性のため **`source`(authoring 元)** と **`external_id`(GH 側 ID)** を持ち、ミラーと authoring を区別する。
- 全テーブルに `created_at`/`updated_at`(UTC, unixepoch)。論理削除はせず物理削除 + GH 側 delete を sync で反映。
- 時刻は **UTC の ISO8601 文字列 or unixepoch**。日付次元(`date` カラム)は JST 基準の `YYYY-MM-DD` を別途保持して日次集計を高速化(タイムゾーン跨ぎの集計ブレ回避)。

```sql
-- ============ マスタ: 筋部位 ============
CREATE TABLE muscle_groups (
  id           TEXT PRIMARY KEY,              -- 'chest','lat','quad' ...(安定slug)
  name_ja      TEXT NOT NULL,                 -- '大胸筋'
  name_en      TEXT NOT NULL,                 -- 'Pectoralis major'
  region       TEXT NOT NULL,                 -- 'upper'|'core'|'lower'
  -- 人体ヒートマップ用。SVGのパスID群やbody mapの領域キーをJSONで保持
  body_map_keys TEXT NOT NULL DEFAULT '[]',   -- JSON array: ['chest_left','chest_right']
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ マスタ: 種目 ============
CREATE TABLE exercises (
  id            TEXT PRIMARY KEY,             -- 'barbell_bench_press'
  name_ja       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  category      TEXT NOT NULL,                -- 'barbell'|'dumbbell'|'machine'|'cable'|'bodyweight'|'cardio'
  is_unilateral INTEGER NOT NULL DEFAULT 0,   -- 0/1 片側種目か
  default_unit  TEXT NOT NULL DEFAULT 'kg',   -- 入力既定単位(表示用ヒント。保存は常にkg)
  -- GHのexerciseタイプへのマッピング(log_activity/exercise書き込み用)
  gh_activity_type TEXT,                      -- 例 'strength_training'
  is_preset     INTEGER NOT NULL DEFAULT 1,   -- プリセット由来か(ユーザー追加は0)
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ 種目→部位 多対多(効く部位 + 主働/協働) ============
CREATE TABLE exercise_muscles (
  exercise_id     TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_group_id TEXT NOT NULL REFERENCES muscle_groups(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,              -- 'primary'|'secondary'|'stabilizer'
  -- ヒートマップ濃度(0.0-1.0)。primary=1.0 secondary=0.5 等の既定をプリセットで投入
  intensity       REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (exercise_id, muscle_group_id, role)
);
CREATE INDEX idx_exercise_muscles_muscle ON exercise_muscles(muscle_group_id);

-- ============ ワークアウト(セッション) ============
CREATE TABLE workouts (
  id            TEXT PRIMARY KEY,             -- uuid/ulid
  date          TEXT NOT NULL,                -- 'YYYY-MM-DD'(JST基準, 集計用)
  started_at    INTEGER NOT NULL,             -- unixepoch UTC
  ended_at      INTEGER,
  note          TEXT,
  source        TEXT NOT NULL DEFAULT 'app',  -- このアプリがauthoring元
  gh_external_id TEXT,                        -- GHにexercise sessionとして書いた際のID(双方向同期用)
  synced_to_gh  INTEGER NOT NULL DEFAULT 0,   -- GH反映済みか
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_workouts_date ON workouts(date);

-- ============ ワークアウトのセット明細 ============
CREATE TABLE workout_sets (
  id           TEXT PRIMARY KEY,
  workout_id   TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id  TEXT NOT NULL REFERENCES exercises(id),
  set_index    INTEGER NOT NULL,             -- 1始まり、種目内の順序
  reps         INTEGER,                       -- 回数(cardioならNULL)
  weight_kg    REAL,                          -- ★常にkgで保存(表示時lb変換)
  rpe          REAL,                          -- 主観強度(任意)
  duration_sec INTEGER,                       -- 有酸素/プランク等
  distance_m   REAL,                          -- 有酸素
  is_warmup    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_sets_workout ON workout_sets(workout_id);
CREATE INDEX idx_sets_exercise ON workout_sets(exercise_id);

-- ============ 食事 ============
CREATE TABLE meals (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,                 -- 'YYYY-MM-DD'(JST)
  logged_at    INTEGER NOT NULL,             -- unixepoch UTC
  meal_type    TEXT NOT NULL,                 -- 'Breakfast'|'MorningSnack'|'Lunch'|'AfternoonSnack'|'Dinner'|'Anytime'
  note         TEXT,
  photo_r2_key TEXT,                          -- 将来用(MVPは常にNULL)
  source       TEXT NOT NULL DEFAULT 'app',
  gh_external_id TEXT,                        -- GH nutrition dataPoint ID
  synced_to_gh INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_meals_date ON meals(date);

-- ============ 食事の食材明細(PFCをアプリ側で正しく保持) ============
CREATE TABLE meal_items (
  id           TEXT PRIMARY KEY,
  meal_id      TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  preset_id    TEXT REFERENCES meal_presets(id) ON DELETE SET NULL, -- プリセット由来なら参照
  food_name    TEXT NOT NULL,
  quantity     REAL NOT NULL DEFAULT 1,       -- 何人前/何g(unitで意味付け)
  unit         TEXT NOT NULL DEFAULT 'serving',
  calories_kcal REAL NOT NULL,
  protein_g    REAL NOT NULL DEFAULT 0,
  fat_g        REAL NOT NULL DEFAULT 0,
  carbs_g      REAL NOT NULL DEFAULT 0,
  fiber_g      REAL,
  sugar_g      REAL,
  sodium_mg    REAL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_meal_items_meal ON meal_items(meal_id);

-- ============ 食事プリセット(よく食べる組合せ) ============
CREATE TABLE meal_presets (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,                 -- 'プロテイン+バナナ'
  -- 明細スナップショットをJSONで保持(プリセット単体で完結させる)
  items_json   TEXT NOT NULL,                 -- [{food_name,quantity,unit,calories_kcal,protein_g,...}]
  default_meal_type TEXT NOT NULL DEFAULT 'Anytime',
  use_count    INTEGER NOT NULL DEFAULT 0,    -- 並べ替え用
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ 体組成(体重・体脂肪)GHミラー + 手動 ============
CREATE TABLE body_metrics (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,                -- 'YYYY-MM-DD'(JST)
  measured_at   INTEGER NOT NULL,             -- unixepoch UTC
  weight_kg     REAL,                          -- ★kg保存
  body_fat_pct  REAL,
  source        TEXT NOT NULL,                -- 'google_health'(ミラー) | 'app'(手動)
  gh_external_id TEXT,                         -- GH dataPoint ID(冪等upsertキー)
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
-- GH由来の重複防止: 同一外部IDは1行(部分ユニーク)
CREATE UNIQUE INDEX idx_body_metrics_gh ON body_metrics(gh_external_id) WHERE gh_external_id IS NOT NULL;
CREATE INDEX idx_body_metrics_date ON body_metrics(date);

-- ============ 睡眠ミラー(GH source of truth) ============
CREATE TABLE sleep_logs (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,                -- 起床日基準 'YYYY-MM-DD'
  start_at      INTEGER NOT NULL,
  end_at        INTEGER NOT NULL,
  total_min     INTEGER NOT NULL,
  deep_min      INTEGER, light_min INTEGER, rem_min INTEGER, awake_min INTEGER,
  efficiency    REAL,
  source        TEXT NOT NULL DEFAULT 'google_health',
  gh_external_id TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX idx_sleep_gh ON sleep_logs(gh_external_id) WHERE gh_external_id IS NOT NULL;
CREATE INDEX idx_sleep_date ON sleep_logs(date);

-- ============ その他センシング日次ミラー(SpO2/呼吸数/HRV/皮膚温/安静時心拍/VO2max等) ============
-- 種類が多く可変なので「縦持ち(EAV風)」で1テーブルに集約。1日1メトリック1行。
CREATE TABLE daily_metrics (
  date         TEXT NOT NULL,                 -- 'YYYY-MM-DD'(JST)
  metric       TEXT NOT NULL,                 -- 'spo2_avg'|'resp_rate'|'hrv_rmssd'|'skin_temp_c'|'resting_hr'|'vo2max'
  value        REAL NOT NULL,
  unit         TEXT NOT NULL,                 -- '%','/min','ms','celsius','bpm','ml/kg/min'
  source       TEXT NOT NULL DEFAULT 'google_health',
  gh_external_id TEXT,
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (date, metric)                  -- ★冪等: 同日同メトリックはupsertで上書き
);

-- ============ 同期状態(増分・重複防止・リトライ) ============
CREATE TABLE sync_state (
  data_type     TEXT PRIMARY KEY,             -- 'body_metrics'|'sleep'|'spo2'|... GHデータタイプ単位
  last_synced_at INTEGER,                      -- 最後に正常同期したunixepoch
  last_cursor    TEXT,                         -- GH側のpageToken/最終取得時刻(増分起点)
  last_status    TEXT NOT NULL DEFAULT 'idle', -- 'idle'|'running'|'ok'|'error'
  last_error     TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### 2.7 kg/lb の保存・表示

| 案 | 内容 | トレードオフ | 判定 |
|---|---|---|---|
| **kg(SI)単独保存 + 表示時変換(採用)** | DB は `weight_kg` のみ。lb は `kg * 2.2046226218` を表示層で算出 | 単一の真実値。丸め誤差が保存に残らない。GH API も SI 前提が多く整合 | ★採用 |
| 両方保存(`weight_kg` と `weight_lb`) | 表示が速い | 二重管理で不整合リスク。編集時に両方更新が必要 | 不採用 |
| 入力単位を保存(`value` + `unit`) | ユーザーが入れたまま | 集計時に毎回正規化。比較・グラフが面倒 | 不採用 |

補足: **入力 UI では「ユーザーが最後に使った単位」を `exercises.default_unit` や端末設定として保持**し、入力体験は lb/kg どちらでも自然にする。保存直前に kg へ正規化。表示は両方併記(要件8)。プレートのインクリメント(2.5kg vs 5lb)が単位で異なるため、UI のステッパー刻みは表示単位に追従させる。

---

## 3. 認証設計

要件: ②Google auth で認証、③ユーザーは自分1人。**「UI ログインのゲート」と「GH API アクセス」は目的が別なので分離設計する。**

### 3.1 二系統の OAuth/OIDC

| 系統 | 目的 | フロー | 検証/保管 |
|---|---|---|---|
| **A. UI ログインゲート** | ブラウザ/PWA から自分だけ入れる | Sign in with Google(OIDC, `openid email`) | ID トークンを **Google JWKS で署名検証** → `iss`/`aud`/`exp` + `sub`/`email` が許可値と一致するか確認 → 自前署名 JWT を **HttpOnly/Secure/SameSite=Lax Cookie** に格納してセッション化 |
| **B. GH API アクセス** | センシングデータの read / 食事・運動の write | サーバーサイド OAuth(`googlehealth.*.readonly`/`writeonly` スコープ群、`access_type=offline`) | `refresh_token` を **KV(TOKENS)** に長命保管。Worker が毎リクエスト失効 60s 前に自動 refresh(既存 Pattern B 踏襲) |

### 3.2 系統 A(UI ゲート)の実装

```ts
// 概念フロー(Hono ルート想定)
// 1) GET /auth/login → Google OAuth 認可URLへリダイレクト(scope=openid email, state付き)
// 2) GET /auth/callback → code交換でid_token取得
//    - Google JWKS (https://www.googleapis.com/oauth2/v3/certs) で署名検証
//    - claims検証: iss in {accounts.google.com, https://accounts.google.com},
//                  aud === GOOGLE_CLIENT_ID, exp未過ぎ
//    - 認可ゲート: claims.email === env.ALLOWED_EMAIL && claims.email_verified === true
//                  (より堅牢に claims.sub === env.ALLOWED_SUB も併用)
//    - 通過したら自前JWT(HS256, 有効期限7-30日)を発行しHttpOnly Cookieへ
// 3) 以降の /api/* は middlewareでCookie JWT検証。不一致なら401→/auth/login
```

- **許可ユーザーの固定**: `ALLOWED_EMAIL`(= tachibanayu24@gmail.com)に加え、安定不変な `ALLOWED_SUB`(Google アカウントの subject)も突き合わせる。email は理論上変わりうるので `sub` 併用が堅牢(要件3:完全自分用を厳格化)。
- **セッション**: 自前 JWT(署名 secret は `SESSION_SIGNING_KEY`)。Google の ID トークン自体をセッションに使い回さない(短命なため)。`jose` 等で検証。
- 公開鍵キャッシュ: Google JWKS は KV/メモリに短期キャッシュし、毎回フェッチしない。

### 3.3 Cloudflare Access を使う選択肢の是非

| 観点 | Cloudflare Access(Zero Trust) | 自前 OIDC ゲート(採用) |
|---|---|---|
| 実装量 | ほぼゼロ(ダッシュボードで email 許可) | ログイン/コールバック/JWT を自作 |
| MCP/Cron との両立 | **問題**: Access は人間ブラウザ前提。MCP(Claude.ai からの machine-to-machine)や Cron に Access SSO を被せると壊れる/迂回設定が要る | ルート単位で認証方式を選べる(/api は Cookie、/mcp は secret+CIDR) |
| 単一 Worker への適合 | パス単位の細かい出し分けがやや窮屈 | Hono middleware で自在 |
| PWA 体験 | Access のログイン画面を挟む(リダイレクト) | アプリ内ログイン UI に統合可 |

**判定**: **自前 OIDC ゲートを採用。** 理由は「同一オリジンに /api(人間)/mcp(マシン)/scheduled(無人)が同居」する本構成では、Access のような全体被せ型 SSO がマシン系経路と相性が悪いため。Access は「無料で堅牢」だが、MCP 同居の出し分けで複雑化する。
ただし**フォールバック案**として、PWA の `/` と `/api/*` だけを Access で守り、`/mcp` を Access 対象外パスにする構成も成立する。実装を最小化したい初期に限り検討可(未決事項 §9-2)。

### 3.4 系統 A と B を統合するか分けるか

- **分ける(採用)**。理由:
  - スコープが全く違う(A は `openid email` だけ、B は health 系の read/write スコープ群)。
  - A はブラウザ対話で頻繁、B はサーバー無人で長命 refresh が要る。同じトークンに混ぜると、A のログインのたびに B のスコープ同意を取り直す羽目になり UX/運用が悪化。
  - B は同意画面を **In production に publish** して 7 日失効を回避する必要がある([Google OAuth 公開ステータス](https://support.google.com/cloud/answer/15549945))。A はログインのたびに対話するので Testing でも実害は小さいが、同一プロジェクト内で publish 済みにしておけば両方安定。
- **初期 B トークン取得**: 既存 MCP と同じく **CLI で 1 回だけ** offline 同意を踏み、`refresh_token` を KV へ投入(`wrangler kv key put`)。Worker は以後 refresh で延命。

---

## 4. Daily Batch(Cron Triggers で GH→D1 ミラー)

### 4.1 何を取り込むか

source of truth が GH 側のセンシングデータのみ:体重/体脂肪(`body_metrics`)、睡眠(`sleep_logs`)、SpO2・呼吸数・HRV(RMSSD)・皮膚温(絶対℃)・安静時心拍・VO2max(`daily_metrics`)。
**食事・ワークアウトは取り込まない(本アプリが authoring 元なので逆流させない)。** これが source of truth 設計の肝。

### 4.2 wrangler の cron 設定例

```jsonc
{
  "triggers": {
    // UTC。JST朝6時=UTC21時、昼に1回、夜に1回の計3回(取りこぼし冗長化)
    "crons": ["0 21 * * *", "0 4 * * *", "0 13 * * *"]
  }
}
```

複数 cron は同一 `scheduled()` に入るので `controller.cron` で分岐可能だが、本件は全 cron で「直近データの増分取り込み」を同じく走らせ、冪等性で重複を吸収する設計にする(取りこぼし対策として日3回)([multiple cron triggers](https://developers.cloudflare.com/workers/examples/multiple-cron-triggers/))。

### 4.3 冪等な取り込みロジック

```ts
// scheduled(controller, env, ctx) の中核(擬似コード)
export default {
  async scheduled(controller, env, ctx) {
    const provider = new GoogleHealthProvider(env); // 系統BのトークンをKVから使う
    const types = ["body_metrics","sleep","spo2","resp_rate","hrv","skin_temp","resting_hr","vo2max"];
    for (const type of types) {
      const st = await getSyncState(env.DB, type);
      try {
        await markRunning(env.DB, type);
        // 増分: last_synced_at（無ければ過去14日）から now までを RFC3339 で取得
        const since = st?.last_synced_at ?? daysAgo(14);
        const dataPoints = await provider.listDataPoints(type, since, now()); // dataPoints.list :reconcile
        // 冪等upsert: gh_external_id をユニークキーに ON CONFLICT で上書き
        await upsertDataPoints(env.DB, type, dataPoints);
        await markOk(env.DB, type, /*cursor*/ now());
      } catch (e) {
        await markError(env.DB, type, e);   // consecutive_failures++
        // 連続失敗が閾値超で通知(§4.5)
      }
    }
  }
}
```

冪等性の担保:
- `body_metrics`/`sleep_logs` は `UNIQUE(gh_external_id)`、`daily_metrics` は `PRIMARY KEY(date, metric)`。
- 取り込みは `INSERT ... ON CONFLICT(...) DO UPDATE`(D1/SQLite の upsert)。**何度走っても結果が同じ。** 日3回起動でも重複行が増えない。
- 増分起点は `sync_state.last_synced_at`。初回は過去 14 日を遡って埋める。GH の `:reconcile`(突合済)エンドポイントを使い、device/manual の重複を避ける(既存 research 確定: `:list` は生、`:reconcile` は突合済)。
- **GH 側で削除されたデータの反映**: ミラーなので「GH に存在しないが D1 にある GH 由来行」を定期的に検出して削除する soft-reconcile を週次で実施(MVP では任意。未決 §9-3)。

### 4.4 GH API 固有の注意(取り込み実装に効く確定事実)

- intraday(心拍など秒精度)は `detailLevel` バケットが無く、ネイティブ ~5 秒サンプルを `dataPoints.list` + RFC3339 秒精度フィルタで取り、**クライアント側ダウンサンプル**が必要。→ daily batch では intraday を毎回引かず、**日次集計値(安静時心拍/HRV 等)だけミラー**し、intraday は MCP の on-demand read に回す(KV キャッシュ TTL 1h)。
- 皮膚温は日次・絶対℃(Fitbit の相対値と非互換)。`daily_metrics.unit='celsius'` で保存。
- API は "actively evolving"(直近 5/26 にも breaking change)。provider 層で GH レスポンスを内部モデルに正規化し、**スキーマ変更の影響を provider に局所化**する。

### 4.5 失敗時リトライ / 通知

- **リトライ**: cron は日3回走るので、1回失敗しても次回が増分で埋める(自然リトライ)。`sync_state.consecutive_failures` を加算。
- **トークン失効検知**: B の refresh が失敗(`invalid_grant`)したら通知必須(無人 Worker の致命傷)。
- **通知手段**(コスト0優先): 既存環境に `cc-remote`(PushNotification)があるが本番運用通知には不向き。MVP は **Cloudflare Email Routing 経由のメール送信**(cloudflare-email-service)か、Worker から自分の Slack/Discord webhook に POST。`consecutive_failures >= 3` で 1 通だけ送る(スパム防止に dedupe)。
- **可観測性**: `wrangler tail` + Workers Logs(Observability)で `scheduled` の各 type の結果をログ。`sync_state` テーブル自体が UI から見えるダッシュボードになる(「最終同期: 2h前 / 体重 OK / 睡眠 ERROR」)。

---

## 5. MCP の同居

### 5.1 共有構成

```
Hono app
 ├─ /api/*   → Cookie(系統A)で保護 → service層 → Provider + D1
 └─ /mcp     → secret+CIDRで保護   → @hono/mcp StreamableHTTPTransport(stateless) → 同じservice層
```

- **provider 層・service 層・D1 アクセス・型(Zod)を UI と MCP で完全共有。** MCP ツールは「UI のバックエンド関数を MCP ツールとして再公開」するだけ。重複実装を作らない。
- 既存 33 ツール資産(log_meal_photo 等)を移植しつつ、**D1 を本体に**するので「Fitbit の PFC silent drop 回避のための KV meal preset ワークアラウンドは廃止**可能**」。理由: ① GH は 5/26 から nutrition 書き込み解禁で PFC を保持できる可能性、② そもそも本アプリは D1 に PFC を完全保持する。→ MCP の preset 系ツールは KV ではなく **D1 の `meal_presets`** を読むように作り替える。

### 5.2 transport と stateless

- **Streamable HTTP(stateless)**。Cloudflare Workers はステートレス + WebStandard transport が要件で、`@hono/mcp` の `StreamableHTTPTransport` を使う([@hono/mcp](https://jsr.io/@hono/mcp), [Cloudflare remote MCP](https://developers.cloudflare.com/agents/guides/remote-mcp-server/))。モバイル/Claude.ai 利用に stateless が必須(既存知見と一致)。
- セッション状態を持たないので、各リクエストで provider を生成し D1/KV にアクセスする。

### 5.3 認証(個人利用)

| 案 | 内容 | トレードオフ | 判定 |
|---|---|---|---|
| **secret in URL + Anthropic CIDR allowlist(採用/踏襲)** | `/mcp/<MCP_SHARED_SECRET>` + `160.79.104.0/21` の allowlist。Claude.ai に OAuth なし Custom Connector 登録 | 実績あり・即動く・単一ユーザー十分。secret 漏洩 + CIDR 内攻撃の二重突破が必要 | ★MVP採用 |
| workers-oauth-provider で OAuth 化 | 正式な MCP OAuth | 単一ユーザーには過剰。Claude.ai 側の Connector 設定も増える | 将来の選択肢 |

CIDR は変わりうるので、**allowlist 値は secret/設定で外出し**し、Anthropic の outbound IP 変更に追従できるようにする。

---

## 6. ローカル開発 〜 デプロイ 〜 secret 管理

### 6.1 wrangler.jsonc 骨子

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "google-health-sidecar",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],

  // PWA(SPA)配信 + API/MCPはWorker優先
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/mcp", "/mcp/*", "/auth/*"]
  },

  "d1_databases": [
    { "binding": "DB", "database_name": "ghsidecar", "database_id": "<id>" }
  ],
  "kv_namespaces": [
    { "binding": "TOKENS", "id": "<id>" },   // 系統BのGH OAuthトークン
    { "binding": "CACHE",  "id": "<id>" }    // GH read結果キャッシュ(TTL1h)
  ],

  "triggers": {
    "crons": ["0 21 * * *", "0 4 * * *", "0 13 * * *"]
  },

  "observability": { "enabled": true },

  // R2は将来用(MVPはコメントアウトで予約)
  // "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "ghsidecar-photos" }],

  "vars": {
    // 非秘匿のみvarsへ。秘匿はsecretへ(§6.3)
    "ALLOWED_EMAIL": "tachibanayu24@gmail.com",
    "ANTHROPIC_CIDR": "160.79.104.0/21"
  }
}
```

注意点:
- **Cron は wrangler 設定で一元管理**(ダッシュボード手編集と混ぜない)。`crons: []` で無効化([cron triggers config](https://developers.cloudflare.com/workers/configuration/cron-triggers/))。
- `compatibility_date` は新しめに。`nodejs_compat` は `jose`(JWT/JWKS)等で有用。

### 6.2 ローカル開発

```bash
pnpm dlx wrangler dev                 # ローカルでASSETS+API+MCP
pnpm dlx wrangler dev --test-scheduled # /__scheduled でcronを手動発火テスト
pnpm dlx wrangler d1 migrations apply ghsidecar --local  # ローカルD1にマイグレーション
```

- フロントは Vite 等でビルド → `dist` を Static Assets が配信。`wrangler dev` でフルスタックをローカル再現。
- D1 はマイグレーションファイル(`migrations/0001_init.sql` …)を `wrangler d1 migrations` で管理。本番/ローカルで同一 DDL。

### 6.3 secret 管理

```bash
# 秘匿値はvarsではなくsecretへ
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET     # 系統A/Bで共有のOAuthクライアント
wrangler secret put SESSION_SIGNING_KEY      # 系統Aの自前JWT署名鍵
wrangler secret put ALLOWED_SUB              # Google subject(不変ID)
wrangler secret put MCP_SHARED_SECRET        # /mcpのURL埋め込みsecret

# 系統BのGH OAuth初期トークンはCLIで1回取得してKVへ投入
wrangler kv key put --binding=TOKENS "gh:refresh_token" "<refresh_token>"
```

- ローカルは `.dev.vars`(gitignore)に同名キーを置く。
- secret はコードにも wrangler.jsonc にも絶対に書かない(`vars` は非秘匿のみ)。

### 6.4 デプロイ

```bash
pnpm build && pnpm dlx wrangler deploy
wrangler d1 migrations apply ghsidecar --remote
```

### 6.5 コスト感(無料枠で収まるか)

| リソース | 単一ユーザー想定負荷 | 無料枠 | 判定 |
|---|---|---|---|
| Workers リクエスト | UI操作 + MCP + cron日3回 → 1日数百〜数千 | 100,000 req/日 | ✅余裕 |
| D1 読み取り | 集計/一覧で1日数千行 | 5,000,000 行/日 | ✅余裕 |
| D1 書き込み | 食事/セット/ミラーで1日数百行 | 100,000 行/日 | ✅余裕 |
| D1 ストレージ | 数年分でも数十MB | 5 GB | ✅余裕 |
| **KV 書き込み** | **トークン refresh + キャッシュ書込** | **1,000/日** | ⚠️注意(下記) |
| KV 読み取り | トークン/キャッシュ参照 | 100,000/日 | ✅余裕 |

**唯一の注意 = KV 書き込み 1,000/日**([KV pricing](https://developers.cloudflare.com/kv/platform/pricing/))。素朴に「毎リクエストでトークンを KV write」「全 read 結果を KV キャッシュ write」すると枯渇しうる。対策:
- トークンは失効間際のみ refresh→write(1日せいぜい数回)。
- read キャッシュは「高頻度に同一クエリが来るもの限定」で書く。あるいはキャッシュ自体を **D1 の一時テーブル or Worker メモリ**に寄せて KV write を節約。
→ この設計を守れば **完全無料枠内**。Workers Paid($5/月)に上げれば KV 制限も大幅緩和されるが、単一ユーザーなら不要。

---

## 7. データフロー要約(source of truth の徹底)

| データ | authoring 元 | 流れ | D1 の役割 |
|---|---|---|---|
| 食事 | **このアプリ** | UI/MCP → D1(完全PFC保持) → GH API write(nutrition) | 真実値(GHは表示先) |
| ワークアウト | **このアプリ** | UI/MCP → D1(セット/レップ/kg) → GH API write(exercise session) | 真実値 |
| 体重/体脂肪 | **GH(センシング)** | Cron で GH→D1 ミラー(冪等)。手動補正は app source で D1→GH write も可 | ミラー + 手動補正 |
| 睡眠/SpO2/HRV 等 | **GH(センシング)** | Cron で GH→D1 ミラー(read専用) | 読み取り専用ミラー |

---

## 8. 部位ヒートマップ(要件7)のデータ的裏付け

- `exercises` × `exercise_muscles`(role/intensity)× `muscle_groups.body_map_keys` で「種目→効く部位+濃度」を表現。
- UI は人体 SVG の領域 ID と `body_map_keys` を対応づけ、`intensity` を色濃度にマップしてヒートマップ描画。
- プリセット投入: 主要種目(BIG3 + 主要マシン/ダンベル種目)を seed マイグレーション(`migrations/0002_seed_exercises.sql`)で初期投入。`is_preset=1`。ユーザー追加種目は `is_preset=0`。

---

## 9. 未決事項・要確認(レビュー時の論点)

1. **UI からの直接写真解析の主体**: MCP 経由(Claude が解析)で当面割り切るか、UI から Workers AI ビジョン or Claude API を直叩きするか。後者なら API キー/コストと、Worker 内画像処理の実装が増える。→ MVP は MCP 経由を推奨、UI 直登録は手入力 + プリセットで先行。
2. **Cloudflare Access の部分採用**: 実装最小化を優先するなら「`/` と `/api/*` だけ Access、`/mcp` は対象外」が成立。自前 OIDC を書く工数とのトレードオフ。本書は自前 OIDC 推奨だが、初速重視なら Access 併用も可。
3. **GH 側削除のミラー反映(soft-reconcile)**: GH で消えたデータを D1 から消す週次ジョブを入れるか。MVP では「追加・更新のみ反映、削除は手動」で割り切り可。
4. **GH→D1 の双方向 write(体重手動補正)**: 体重を app から補正入力した場合に GH へ書き戻すか。書き戻すと source of truth が二重化するので、原則「体組成は GH が真実、app からは閲覧のみ」が安全。手動入力したいなら `source='app'` で D1 にだけ持ち、GH には書かない判断もあり(要オーナー確認)。
5. **GH API の breaking change 追従**: "actively evolving" のため provider 層を薄いアンチコラプションレイヤとして設計し、internal model に正規化(本書方針)。Fitbit dual-run(2026-09 停止)までは Fitbit provider をフォールバックに残すか即廃止かは移行スケジュール次第。
6. **MCP allowlist CIDR の追従**: Anthropic outbound CIDR が変わった際に secret/設定更新だけで対応できるようにする(ハードコード禁止)。

---

## 主要根拠ソース

- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) / [Static Assets binding(run_worker_first / SPA)](https://developers.cloudflare.com/workers/static-assets/binding/) / [Pages→Workers migration](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- [Cloudflare Pages vs Workers 2026](https://dev.to/rickcogley/cloudflare-pages-vs-workers-in-2026-migration-guide-ka7)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) / [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) / [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) / [KV limits](https://developers.cloudflare.com/kv/platform/limits/)
- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) / [Multiple cron triggers](https://developers.cloudflare.com/workers/examples/multiple-cron-triggers/) / [Scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [Build a Remote MCP server](https://developers.cloudflare.com/agents/guides/remote-mcp-server/) / [@hono/mcp](https://jsr.io/@hono/mcp) / [MCP transport](https://developers.cloudflare.com/agents/model-context-protocol/transport/)
- [Validate Google ID token on CF Workers](https://community.cloudflare.com/t/validate-google-auth-id-token-on-cf-workers/381293) / [Google OAuth 公開ステータスと7日失効](https://support.google.com/cloud/answer/15549945)

---

(注: 本リポジトリは現状 `.design-workflow.js` のみで実コードは未着手。上記は新規構築の設計提案であり、実装ファイルは存在しない。)

---

# research:pwa-ui

I now have all the facts I need. Let me write the design document directly as my final response.

---

# 設計書: PWA / UI-UX と 人体ヒートマップ + 種目→部位プリセット

対象リポジトリ: `/Users/yuto/Workspace/tachibanayu24/google-health-sidecar`(現状ほぼ空 / git未init)
作成日: 2026-05-31 / 単一ユーザー(tachibanayu24@gmail.com)専用
スコープ: 要件4(優れたCRUD UI)、5(モバイル最適化PWA)、7(人体ヒートマップ + 種目→部位プリセット)、8(kg/lb両表示)。MCP / GH API / 認証は別パートの設計書で扱う前提で、ここはフロントエンドとデータ可視化に集中する。

---

## 0. 結論サマリ(先に意思決定だけ知りたい人向け)

| 論点 | 推奨 | 一行理由 |
|---|---|---|
| フロント構成 | **React 19 + Vite + Cloudflare Vite Plugin(v1 GA)、API側は同一WorkerのHono** | Workers公式の第一級SPA構成。バックエンド(MCPもHono)と言語・型・モノレポを共有でき、Workers Assetsで静的配信まで1 Workerに収まる。 |
| ヒートマップ | **`react-native-body-highlighter`のSVGポリゴンを取り込み自前React薄ラッパ化**(またはfork `body-highlighter`を直採用) | npmの`react-body-highlighter`本家は2021年で停止。本家RNフォークは2026-04も更新中=SVG資産が最新。 |
| 種目マスタ初期データ | **`free-exercise-db`(yuhonas, Public Domain)を一次採用、wgerのJP訳を後付け補完** | 800+種目・primary/secondary muscles・equipment・画像つきでPublic Domain=ライセンス完全フリー。日本語訳だけ自前/wger補完。 |
| チャート | **Recharts**(体重/ボリューム推移) | データ点が少ない個人用途で実装速度最優先。visxは過剰。 |
| PWA | **vite-plugin-pwa(generateSW)+ オフライン下書きはIndexedDB + Background Sync** | 食事/ワークアウトはこのアプリがauthoring元=書き込み信頼性が要る。ジムは電波が弱いのでオフライン下書きは必須級。 |
| プッシュ通知 | **v1ではスコープ外(休憩タイマーはローカル通知/Web Audioで代替)** | iOSのWeb Pushはhome-screen追加+standalone必須で運用が脆い。単一ユーザーに見合わない。 |
| 単位 | **保存は常にkg(SI、GH APIもkg)。表示・入力単位はユーザー設定でkg/lb切替、両方を併記表示** | source of truthを単一化。換算は表示層のみ。 |

---

## 1. 人体筋肉ヒートマップ

### 1-1. 候補比較

調査時点 2026-05-31。最終更新日・ライセンスは下記の通り確認済み。

| ライブラリ | npm/repo | ライセンス | 最終更新 | 前面/背面 | 筋群粒度 | ヒートマップ(強度色) | React/Web対応 | TS | 評価 |
|---|---|---|---|---|---|---|---|---|---|
| **react-native-body-highlighter** | `react-native-body-highlighter` (HichamELBSI) | MIT | **v3.2.0 / 2026-04-13(活発)** | 両対応(`side: front/back`)、gender別あり | 24部位 | あり(`colors[]` + `intensity` 1..n) | **RN専用**(react-native-svg依存) | 99.7% TS | SVG資産が最新で最良。ただしWeb直利用不可、ポリゴン抽出が必要 |
| **react-body-highlighter** | `react-body-highlighter` (giavinh79) | MIT | **v2.0.5 / 2021-07(停止)** | 両対応(`type: anterior/posterior`) | 20+部位 | あり(`highlightedColors[]` 頻度別) | React/Web直対応 | TS | Web向けにそのまま使える唯一の本家だが5年停滞。上記RN版のSVGを移植したもの |
| **body-highlighter** (fork) | `body-highlighter` (lahaxearnaud) | MIT | **v3.0.2 / 2025-11(活発)** | 両対応(`ModelType`) | 20+部位 | あり(`highlightedColors[]` 頻度別) | **framework-agnostic**(vanilla/React/Vue/Svelte/Astro)、ランタイム依存ゼロ、DOM直描画 | TS5 | react-body-highlighterのfork。Web前提で活発=実用上の本命 |
| react-muscle-highlighter | `react-muscle-highlighter` (soroojshehryar) | (要確認、libraries.io掲載) | 比較的新しいが採用実績少 | 両対応 | カスタム筋群 | intensity levelsあり | React、依存React only | TS | 利用実績が薄く検証コスト高。保留 |
| 自前SVG | — | 自分で決定 | — | 自前 | 任意 | 任意 | 任意 | 任意 | 工数大(下記) |

### 1-2. 推奨と根拠

**第一候補: `body-highlighter`(lahaxearnaudのfork)をそのまま採用。**
- React/Vue非依存でWeb DOM直描画。React 19のSPAに薄く載せられる。
- `highlightedColors` が「筋肉が何回効かされたかの頻度」で色を変える設計=要件7の「ヒートマップ」そのもの。直近期間(例: 直近7日)の各種目のprimary/secondary muscle出現回数を集計→頻度の高い筋ほど濃い色、で実現できる。
- 2025-11更新でTS5対応=メンテされている。MITで商用/改変自由。

**第二候補(資産だけ拝借): `react-native-body-highlighter` のSVGポリゴンデータを取り込み自前の薄いReactコンポーネント化。**
- このRN版が3系統(本家giavinh79 / fork lahaxearnaud / RN本家HichamELBSI)の中で**唯一2026年も活発**で、ポリゴン精度・部位数(24)が最新。
- もし`body-highlighter`(fork)の部位粒度や見た目が不満なら、RN版の`bodyFront.ts/bodyBack.ts`のSVGパス配列(MIT)をコピーし、`react-native-svg`を素のSVG/`<svg><polygon>`に置換するだけ。ポリゴンは座標配列なので置換は機械的で、実工数は半日〜1日程度。

**自前SVGをフルスクラッチする場合の現実的工数(参考、非推奨):**
- 前面・背面の筋骨格イラスト作成(医学的に妥当な筋群分割)+各筋群を独立`<path>`化+部位IDマッピング。デザイナー実働でSVG作成3〜5日、開発側のID命名・当たり判定・ヒートマップ色補間で2〜3日。**計1〜2週間。** MIT資産があるため新規構築の便益はほぼない。採用しない。

### 1-3. 実装方針(ヒートマップ生成ロジック)

- 各種目は後述の種目マスタで `primaryMuscles[] / secondaryMuscles[]`(英語キー: chest, biceps, triceps, lats, quadriceps, ...)を持つ。
- ヒートマップ表示時:対象期間のワークアウトを走査し、筋ごとにスコアを集計。`primary=1.0 / secondary=0.5` 重み × セット数(またはボリューム)で加算。
- スコアを0..1に正規化→`highlightedColors`の連続パレット(例: 薄青→濃赤)にマッピング。
- 種目マスタの筋キー(free-exercise-db語彙)とライブラリの`MuscleType`語彙の差分を吸収する**マッピングテーブル**を1枚持つ(例: `lats → upper-back`, `glutes → gluteal`)。これがこの機能の唯一の地味な実装コスト。未マッピング筋は無視+ログ。
- 用途2系統:
  1. **当日/期間サマリのヒートマップ**(直近どこを鍛えた/サボったか)。
  2. **種目図鑑での単一種目プレビュー**(その種目が効く部位をprimary濃/secondary淡で2色表示)。

---

## 2. 種目→部位データセット

### 2-1. 候補比較(調査時点 2026-05-31)

| データセット | repo/出典 | ライセンス | 種目数 | primary/secondary muscle | equipment | 画像/手順 | 多言語/日本語 | 評価 |
|---|---|---|---|---|---|---|---|---|
| **free-exercise-db** | yuhonas/free-exercise-db | **Public Domain(unlicense相当、完全フリー)** | **800+** | あり(`primaryMuscles[]/secondaryMuscles[]`) | あり(`equipment`) | あり(`images[]`はraw.githubusercontentで配信可)、`instructions[]`英語 | **英語のみ** | 1種目=1JSON + 結合`dist/exercises.json`、JSON Schema準拠。導入が最も容易でライセンス障壁ゼロ |
| **wger** | wger-project/wger API | コードAGPL-3.0 / **データはCC-BY-SA 3.0(継承+表示義務)** | **845+** | あり(target/secondary muscles) | あり(12種) | あり、説明文 | **30〜38言語(日本語含む可能性)、Weblate翻訳** | データがCC-BY-SAなので**継承条項(SA)が自分のDBに伝播するリスク**。日本語訳が最大の魅力 |
| exercemus/exercises | exercemus/exercises | コードMIT/**各種目は元ライセンス継承** | (非公開、wger+exercises.json由来) | あり | あり | あり、tips/tempo/video | なし | 出自がwger+exercises.json混在=ライセンス追跡が面倒。単独採用しない |
| exercises.json | Ollie Jennings(free-exercise-dbの元) | Public Domain | ~800(free-exercise-dbと重複) | あり | あり | あり | 英語のみ | free-exercise-dbの上流。直接はfree-exercise-dbを使う |

### 2-2. 推奨

**初期データ(種目マスタの seed)は `free-exercise-db`(Public Domain)を一次採用。**

根拠:
- **ライセンスが完全フリー**=このアプリのDBに取り込んでも継承義務・表示義務が一切発生しない。単一ユーザー私用だが、将来公開(要件1)するときに最も安全。
- 800+種目、`primaryMuscles/secondaryMuscles/equipment/category/level/mechanic/force/images/instructions` を完備=要件7のヒートマップ用筋データがそのまま使える。
- 1ファイルにまとまった`dist/exercises.json`をビルド時に取り込み→D1の`exercises`テーブルに seed する(後述スキーマ)。画像はraw.githubusercontentのホスト画像URLをそのまま参照するか、R2にミラー。

**日本語対応の方針(英語のみが唯一の弱点):**
- free-exercise-dbは英語のみ。日本語表示は以下のいずれか:
  - (a) **自前で `name_ja` を付与**(ベンチプレス等、頻用50〜100種目だけ手動 or LLM一括翻訳。私用なら十分)。種目マスタに`name_ja`列を持たせ、空ならフォールバックで英語表示。
  - (b) **wgerの日本語訳を名寄せで補完**。ただしwgerデータはCC-BY-SAで、訳文を取り込むと**取り込んだ訳文部分にSA継承が及ぶ**。私用なら問題ないが将来公開時はAttribution表記が必要になる。よって(a)を基本、(b)は補助。
- **未決事項**: 日本語訳をLLM(このアプリのMCP経由でClaude)に「種目名→日本語+よみがな」生成させバッチ投入する案。コストほぼゼロで実用的。要オーナー判断。

### 2-3. 種目マスタD1スキーマ(抜粋・提案)

```
exercises(
  id TEXT PK,              -- free-exercise-dbのid
  name TEXT,               -- 英語名
  name_ja TEXT NULL,       -- 日本語名(任意補完)
  category TEXT,           -- strength/cardio 等
  equipment TEXT NULL,
  force TEXT NULL, level TEXT NULL, mechanic TEXT NULL,
  primary_muscles TEXT,    -- JSON配列
  secondary_muscles TEXT,  -- JSON配列
  images TEXT,             -- JSON配列(URL)
  instructions TEXT,       -- JSON配列(英語)
  is_custom INTEGER DEFAULT 0,  -- 自前追加種目フラグ
  is_favorite INTEGER DEFAULT 0
)
```
ユーザー独自種目はSeed後に`is_custom=1`で追加可能(要件4のCRUD)。

---

## 3. UI設計(要件4 / 5 / 7 / 8)

### 3-1. 全体ナビゲーション(モバイルファースト)

下部固定タブバー(5枚)+ FAB(中央の記録ボタン)。iOSのhome-screen追加時のセーフエリア対応必須。

```
┌──────────────────────────────┐
│  ステータスバー(セーフエリア)      │
│                              │
│        [ アクティブ画面 ]         │
│                              │
│                              │
├──────────────────────────────┤
│ 今日   履歴    (＋)   図鑑   設定 │  ← 下部タブ。中央＋はFAB(記録)
└──────────────────────────────┘
```

中央 (＋) タップ → アクションシート:「ワークアウト記録」「食事記録」「体重記録」。

画面一覧:
1. **今日 (Today)** — 今日のサマリダッシュボード
2. **ワークアウト記録 (Workout Logger)** — 記録のメイン体験
3. **食事記録 (Meal Logger)**
4. **履歴・トレンド (History/Trends)** — チャート
5. **種目図鑑+ヒートマップ (Exercise Library)**
6. **設定 (Settings)**

### 3-2. 今日 (Today)

```
┌──────────────────────────────┐
│ 2026-05-31 (土)               │
│ ┌──────────┐ ┌─────────────┐ │
│ │ 体重       │ │ 睡眠          │ │  ← GHからバッチ吸上げ(read-only表示)
│ │ 72.4 kg    │ │ 7h12m        │ │
│ │ 159.6 lb   │ │ 深い 1h20m    │ │
│ └──────────┘ └─────────────┘ │
│ ┌──────────────────────────┐ │
│ │ 今日のワークアウト             │ │
│ │ 胸の日 · 5種目 · 18セット      │ │
│ │ 総ボリューム 8,420 kg         │ │  ← このアプリがauthoring
│ │ [続きを記録]                  │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ 今日の食事  P130 F60 C210     │ │
│ │ 1,980 kcal / 目標2,200       │ │
│ │ [朝][昼][夜][間食] 写真で追加 │ │
│ └──────────────────────────┘ │
│ ┌── 直近7日 筋ヒートマップ ──────┐ │
│ │ [前面SVG]      [背面SVG]      │ │  ← body-highlighter
│ │ 胸=濃赤 脚=未刺激=グレー       │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```
体重・睡眠は「センシングデータ=GHがsource of truth」なので**読み取り専用カード**(値の出所バッジ「Google Health」を付ける)。ワークアウト/食事は編集可能。

### 3-3. ワークアウト記録(最重要UX)

要件: 種目選択→セット入力(重量×レップ)、前回値プレフィル、休憩タイマー、RPE、ボリューム自動計算、kg/lb両表示と入力単位トグル。

**フロー: セッション開始 → 種目追加 → セット入力ループ。**

セッション画面(種目をカード積み上げ):
```
┌──────────────────────────────┐
│ ← 胸の日           02:14 経過 ⏱  │  ← セッションタイマー
│                              │
│ ┌── ベンチプレス ───────── ⋮ ──┐│  ← ⋮で編集/削除/入替
│ │ 前回: 80kg×8,8,7 (5/27)      ││  ← 前回値プレフィル元
│ │ ┌Set─重量────レップ─RPE──✓─┐ ││
│ │ │ 1 │ 80.0kg │  8  │ 8 │ ☑ │ ││  ← ✓で完了。完了で休憩タイマー自動起動
│ │ │ 2 │ 80.0kg │  8  │ 8 │ ☑ │ ││
│ │ │ 3 │ 80.0kg │  7  │ 9 │ ☐ │ ││  ← 入力中の行。重量はプレフィル済
│ │ └──────────────────────────┘ ││
│ │ 単位: [kg]‹›[lb]   +セット追加  ││  ← 入力単位トグル(行内表示は両併記)
│ │ ボリューム: 1,840 kg / 4,057 lb ││  ← 自動計算
│ └──────────────────────────────┘│
│ ┌── インクラインDB ──────────────┐│
│ │ ...                            ││
│ └──────────────────────────────┘│
│ [＋ 種目を追加]                    │
│                                  │
│ ┌── 休憩 ─────────── 01:30 ──┐   │  ← セット✓で起動。残り時間カウントダウン
│ │ ▓▓▓▓▓▓░░░░  [+30s][スキップ]│   │     満了でバイブ+Web Audioビープ
│ └──────────────────────────┘   │
│ [セッションを終了して保存]          │
└──────────────────────────────┘
```

UX詳細:
- **種目選択**: 「+種目を追加」→検索/お気に入り/最近使った/部位フィルタ(ヒートマップ図鑑と同じ語彙)。各種目に部位プレビュー(小SVG)。
- **前回値プレフィル**: 同一種目の直近セッションの重量×レップを各セット行にデフォルト投入。タップで上書き。「前回: 80kg×8,8,7」を見出しに表示。漸進性過負荷(progressive overload)の判断材料。
- **セット入力**: 重量は数値ステッパー+直接入力(0.5/1.25/2.5刻みのクイックボタン)。レップ・RPE(6〜10、0.5刻み)も同様。✓チェックでセット確定。
- **休憩タイマー**: セット✓で自動起動(種目ごとにデフォルト秒数を持てる)。満了で `navigator.vibrate` + Web Audioビープ(プッシュ通知不要)。+30s/スキップ。
- **ボリューム自動計算**: Σ(重量×レップ)を種目ごと/セッション全体でkg・lb両表示。
- **単位**: グローバル設定の単位を既定、種目カード内に`[kg]‹›[lb]`トグルで一時切替。表示は常に両併記(例 `80.0 kg / 176.4 lb`)。
- **保存**: セッション終了で1ワークアウトとしてGHのexercise + 自前D1(セット詳細はGHに持てないのでD1が真の記録、GHには集計をwrite)に保存。

### 3-4. 食事記録

要件: プリセット呼び出し、写真→解析、PFC表示。GH移行後はnutrition writeが解禁されPFC silent drop問題が消える見込み(調査事実)だが、preset機構は使い勝手として残す。

```
┌──────────────────────────────┐
│ ← 昼食                          │
│ ┌── 写真で記録 ───────────────┐ │
│ │  [📷 撮影] [🖼 ライブラリ]      │ │  ← Claude(MCP log_meal_photo相当)が解析
│ │  解析結果:                     │ │
│ │   ・鶏胸肉 200g  P46 F4 C0 230k│ │  ← items[]を編集可能なリストで提示
│ │   ・白米 150g    P4 F0 C56 252k│ │
│ │  合計 P50 F4 C56 482kcal        │ │
│ │  [編集] [この内容で記録]         │ │
│ └──────────────────────────┘ │
│ ┌── プリセットから ─────────────┐ │
│ │ ★ 朝の定番(オートミール+卵)     │ │  ← list_meal_presets相当
│ │ ★ プロテイン 1杯               │ │
│ │ [+ 今の食事をプリセット保存]      │ │
│ └──────────────────────────┘ │
│ ┌── 手入力 ──────────────────┐ │
│ │ 食品名 / 量 / P F C / kcal     │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```
- 写真解析はフロントで撮影→画像をMCP/バックエンド経由でClaudeに渡し`items[]`を得る(既存`log_meal_photo`の体験を移植)。
- PFCはマクロ円グラフ+数値。日次の対目標プログレスバー。
- プリセット保存/呼び出し/削除は要件4のCRUDの一部。

### 3-5. 履歴・トレンド

```
┌──────────────────────────────┐
│ [体重][ボリューム][PFC][睡眠] ←タブ│
│ 体重トレンド  期間[1M][3M][1Y]    │
│  73┤      ╲                    │
│  72┤    ╲╱ ╲___                │  ← Recharts LineChart
│  71┤            ╲__            │
│    └─────────────────────────│
│  72.4kg / 159.6lb (▼0.8kg/30d) │
│ ┌── ワークアウト履歴 ──────────┐ │
│ │ 5/31 胸 8,420kg [編集][削除]   │ │  ← 行スワイプで編集/削除
│ │ 5/29 背中 9,100kg              │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```
- 体重は二軸で隠さずkg主・lb副表示(または設定単位主)。
- ボリュームは部位別積み上げ or 総量推移。
- 履歴行は左スワイプで編集/削除(要件4)。削除は確認モーダル。

### 3-6. 種目図鑑 + ヒートマップ(要件7の主役)

```
┌──────────────────────────────┐
│ 種目図鑑   🔍検索  [部位で絞込 ▾] │
│ ┌── 部位フィルタ(タップ式SVG) ──┐ │
│ │ [前面SVG]   [背面SVG]          │ │  ← body-highlighter。筋タップで絞込
│ │ 胸を選択中                      │ │
│ └──────────────────────────┘ │
│ ┌── 該当種目 ──────────────────┐ │
│ │ [img] ベンチプレス             │ │
│ │   主:胸 副:三頭/三角前          │ │  ← primary/secondary
│ │ [img] ダンベルフライ            │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```
種目詳細ページ:画像/手順(英語、name_jaあれば日本語見出し)+ **その種目専用のミニヒートマップ**(primary濃/secondary淡)+「ワークアウトに追加」ボタン。

### 3-7. 設定

- 単位(kg / lb 既定の選択)、目標(体重・PFC・カロリー)、休憩タイマー既定秒、Google Health連携状態、種目マスタ更新/seed再取り込み、PWAインストール導線の説明。

### 3-8. 編集/削除UX共通方針(要件4)

- 一覧は**左スワイプでアクション(編集/削除)**。削除は破壊操作なので確認 + アンドゥトースト(5秒)。
- 編集はインライン or ボトムシート。保存はOptimistic UI(即反映→失敗でロールバック+トースト)。
- センシングデータ(体重/睡眠)は編集UIを出すが「Google Healthに書き戻す」旨を明示(source of truthはGH)。

---

## 4. PWA技術

### 4-1. フロントフレームワーク選定

| 構成 | 長所 | 短所 | 判定 |
|---|---|---|---|
| **React 19 + Vite + Cloudflare Vite Plugin(v1 GA)+ 同一WorkerにHono API** | 公式の第一級SPA構成。Vite devがWorkersランタイム上で動く。Workers Assetsで静的配信。MCPもHonoなのでバックエンド完全共有(型・Zod・D1バインディング)。リッチなインタラクション(休憩タイマー/ドラッグ並替/SVGヒートマップ)に最適 | クライアントJS量はSSRより多い(私用1ユーザーなら非問題) | **採用** |
| Hono + JSX(SSR) | 超軽量、Honoだけで完結 | リッチなクライアント状態(タイマー/楽観更新/オフライン下書き)にReactのエコシステムが欲しい。SVGヒートマップライブラリもReact前提が多い | 不採用 |
| Next.js on Workers(vinext) | Next資産流用 | 単一ユーザーのSPAにNextは過剰。ビルド/デプロイ複雑化 | 不採用 |

**推奨スタック**: React 19 + Vite + `@cloudflare/vite-plugin`(v1 GA)、ルーティングはTanStack Router、サーバ状態は**TanStack Query**(オフライン/楽観更新/キャッシュに最適)、UIは**Tailwind + shadcn/ui**(モバイル最適なコンポーネント、ダーク前提のジム映え)、API/MCPは同一Worker内Hono。D1/KV/R2バインディングをフロントAPIから直接利用。

### 4-2. manifest

```jsonc
{
  "name": "Google Health Sidecar",
  "short_name": "GH Sidecar",
  "display": "standalone",      // ← iOS Web Push/インストール体験に必須
  "orientation": "portrait",
  "theme_color": "#0b0b0c",
  "background_color": "#0b0b0c",
  "start_url": "/?source=pwa",
  "icons": [ /* 192,512,maskable */ ],
  "categories": ["health","fitness"]
}
```

### 4-3. Service Worker / オフライン同期

**要否の判断: オフライン下書き→オンライン同期は「必要」。** 理由:ジムは地下/RC造で電波が弱い。かつ食事・ワークアウトは**このアプリがauthoring元**=取りこぼすと真のデータが消える。読み取り系(体重/睡眠)はGHが source of truthなので最悪再取得できるが、書き込みは守る価値が高い。

設計:
- **vite-plugin-pwa(`generateSW` + Workbox)** でアプリシェル(JS/CSS/HTML)をprecache→完全オフライン起動可。
- **書き込みは IndexedDB アウトボックスパターン**:記録(セット/食事)は即IndexedDBに保存→TanStack QueryのMutationキューで送信。失敗/オフライン時は**Background Sync API**(`sync`イベント)で再送、未対応(iOS Safari)では**起動時/オンライン復帰時(`online`イベント)にフラッシュ**するフォールバック。
- read系(GHからの体重/睡眠/プロフィール)はStale-While-Revalidate。種目マスタ(D1から)はCache First(変化が稀)。
- 競合: 単一ユーザーかつauthoring元が本アプリなので、書き込み競合はほぼ無い。サーバ側は冪等キー(クライアント生成UUID)で重複送信を弾く。

### 4-4. インストール導線

- **Android/Chrome**: `beforeinstallprompt`を捕捉し、設定画面に「ホーム画面に追加」ボタン。
- **iOS/Safari**: `beforeinstallprompt`非対応のため、初回かつ非standalone(`navigator.standalone===false`)を検知し、「共有→ホーム画面に追加」の手順をイラスト付きで一度だけ案内。iOS 26では追加サイトが既定でWebアプリ起動になるため体験は良い。

### 4-5. プッシュ通知の要否

**v1ではスコープ外(採用しない)。**
- 唯一の通知ニーズは**休憩タイマー満了**。これはアプリ前面にいる前提なので `navigator.vibrate` + Web Audioビープ + アプリ内バナーで足りる。
- iOSのWeb Pushは「home-screen追加 + standalone必須」かつ運用が脆く(EU不可等の制約)、単一ユーザー私用に対し実装/VAPID鍵管理コストが見合わない。
- 将来「夕方の食事記録リマインド」等が欲しくなったら、まず**ローカル通知(Notifications API + SWのタイマー)**で検討、それでも不足ならWeb Push(VAPID + Cloudflare Workers)を後付け。設計上の拡張余地だけ残す(アウトボックス同様SWは既にある)。

### 4-6. チャートライブラリ

| 候補 | gzip | 学習コスト | 判定 |
|---|---|---|---|
| **Recharts** | 中(~Recharts) | 低(コンポーネントAPI) | **採用**: データ点が少ない個人用途で実装速度最優先。LineChart/AreaChart/BarChartで体重・ボリューム・PFCを全部賄える |
| visx | 小(~15KB、合計30-50KB) | 高(D3知識、初回2-3倍時間) | 不採用: カスタム描画やズーム/ブラシが要るほどの規模でない |
| Chart.js (react-chartjs-2) | 大(~92KB core) | 中 | 不採用: 重い。Canvas性能が要るほどの点数でない |

---

## 5. kg/lb(要件8)

### 5-1. 換算定数・丸め

- **定数**: `1 kg = 2.2046226218 lb`(`LB_PER_KG = 2.2046226218`)。逆は `1 lb = 0.45359237 kg`(定義値、こちらが厳密)。実装は**kg→lb: `kg * 2.2046226218`**、**lb→kg: `lb * 0.45359237`** を採用(0.45359237が国際協定の定義値なので往復誤差を最小化)。
- **保存単位 = 常に kg(SI)**。Google Health APIも質量はkg。DBの`weight`列は`REAL`でkg固定。lbは一切保存しない=source of truthを単一化し丸め誤差の蓄積を防ぐ。
- **丸め方針**:
  - 体重表示: kgは小数1桁(72.4 kg)、lbは小数1桁(159.6 lb)。
  - 挙上重量(プレート単位): kgは0.5刻み入力・小数1桁表示、lbは小数1桁表示。
  - ボリューム合計: 整数(8,420 kg / 18,564 lb)。
  - 丸めは**表示時のみ**(`toFixed`相当、四捨五入)。内部計算・保存は常にフル精度のkg。

### 5-2. 表示/入力での扱い

- **表示**: 主単位(設定値)+副単位を常時併記。例 `80.0 kg / 176.4 lb`。チャートの軸も主単位、ツールチップで両方。
- **入力**: グローバル既定単位 + 画面内トグル(`[kg]‹›[lb]`)。lb入力時は内部で即kgに変換して保存。入力刻みは単位に追従(kg: 0.5/1.25/2.5、lb: 1/2.5/5)。
- **設定**: 既定単位(kg/lb)を1つ選ぶ。切替は表示にのみ影響、保存データは不変。

---

## 6. 未決事項・トレードオフ・要オーナー判断

1. **日本語種目名**: free-exercise-dbは英語のみ。(a)頻用種目だけ`name_ja`手動/LLM補完(推奨、私用で十分)か、(b)wgerのJP訳取り込み(CC-BY-SAの継承・表示義務が将来公開時に発生)か。→ **要判断。当面(a)、LLMバッチ翻訳を提案。**
2. **ヒートマップライブラリの最終選定**: `body-highlighter`(fork, 2025-11, framework-agnostic)で見た目・部位粒度が満足なら即採用。不満なら`react-native-body-highlighter`(2026-04)のSVGポリゴンを抽出し自前ラッパ化(半日〜1日)。→ **実物のビジュアル確認後に確定。**
3. **セット詳細の保存先**: GHのexerciseはセット単位の重量×レップ×RPEを保持できない。**真の記録はD1**(`workout_sets`)に持ち、GHには集計(総時間/カロリー/種目)をwriteする二重持ちになる。→ 設計上はD1がワークアウトのsource of truth(プロダクト前提とも整合)。GH writeはあくまでセンシング系エコシステムへの露出。
4. **画像配信**: free-exercise-dbの画像をraw.githubusercontent直リンクするか、R2へミラーするか。→ 安定性・速度ならR2ミラー推奨だが初期はGitHub直リンクで可。
5. **プッシュ通知**: v1スコープ外。将来必要なら設計拡張余地あり(SW・VAPID)。
6. **オフラインBackground Sync**: iOS SafariはBackground Sync API未対応。`online`イベント+起動時フラッシュのフォールバックが主経路になる点を許容する。

---

## 参考(調査ソース、2026-05-31時点で確認)

- react-native-body-highlighter (MIT, v3.2.0 / 2026-04-13): https://github.com/HichamELBSI/react-native-body-highlighter
- react-body-highlighter (MIT, v2.0.5 / 2021-07, 停止): https://github.com/giavinh79/react-body-highlighter
- body-highlighter fork (MIT, v3.0.2 / 2025-11, framework-agnostic): https://github.com/lahaxearnaud/body-highlighter
- free-exercise-db (Public Domain, 800+種目): https://github.com/yuhonas/free-exercise-db
- wger (AGPL-3.0 / データCC-BY-SA 3.0, 845+, 30-38言語): https://github.com/wger-project/wger , https://wger.de/en/software/api
- exercemus/exercises (MIT, wger+exercises.json由来): https://github.com/exercemus/exercises
- Cloudflare Vite Plugin / React SPA + Worker API: https://developers.cloudflare.com/workers/vite-plugin/tutorial/ , https://developers.cloudflare.com/workers/framework-guides/web-apps/react/
- vite-plugin-pwa (Workbox, generateSW/injectManifest): https://github.com/vite-pwa/vite-plugin-pwa , https://vite-pwa-org.netlify.app/
- iOS PWA Web Push(16.4+, standalone必須, EU不可): https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
- Reactチャート比較(Recharts/visx/Chart.js): https://blog.logrocket.com/best-react-chart-libraries-2025/

---

# research:workout-domain

This is the decisive confirmation. The GH v4 `exercise` data point has `exerciseType`, `displayName`, `notes`, `activeDuration`, `interval`, `splits/splitSummaries` (distance/time/calorie-based), `exerciseEvents` (start/stop/pause/split), and `metricsSummary` (calories/HR/etc) — but **no segments-with-repetitions, no per-set weight, no RPE, no set-type**. The strength-training set/rep/load ledger has nowhere to live in GH. The two-layer thesis in the brief is confirmed.

I have everything I need. Producing the design doc now.

---

# 設計書: ボディメイク・ドメインモデル と Google Health マッピングの緊張関係

対象リポジトリ: `google-health-sidecar`(新規・ほぼ空)
スタック前提: Cloudflare Workers + Hono + D1 + KV、Google OAuth(Pattern B)、PWA、MCP併設
作成日: 2026-05-31 / オーナー: tachibanayu24@gmail.com(単一ユーザー)

このドキュメントは、コードベースを読めないレビュアー(普段使いの Claude アプリ)が単独で判断できるよう、根拠・代替案・トレードオフ・未決事項を明示する。スコープは「(A) 筋トレ・ボディメイクの D1 ドメインモデル」「(B) D1 ↔ Google Health(GH)の二層同期規約」「(C) 部位ヒートマップ集計ロジック」「(D) プリセット/テンプレート」「(E) 派生指標・ビュー」の5点。

---

## 0. 確定した「中核の緊張関係」(検証結果)

タスクで「要検証だが極めて濃厚」とされた仮説を、GH v4 / その基盤である Android Health Connect の公式リファレンスで検証した。結論: **仮説は確定(confirmed)**。

GH v4 `exercise` データポイント(`users.dataTypes.dataPoints` の `exercise` 型)が持つフィールドは以下が全て:

| フィールド | 内容 |
|---|---|
| `interval` (SessionTimeInterval) | 開始/終了 |
| `exerciseType` (enum) | 種目「分類」。`STRENGTH_TRAINING` 等の粗い enum で、ベンチプレス等の個別種目名は持てない |
| `activeDuration` (Duration) | 実働時間 |
| `displayName` / `notes` (string) | 表示名・自由メモ |
| `splits[]` / `splitSummaries[]` | ラップ/スプリット。区切り基準は **distance / time / calories のみ** |
| `exerciseEvents[]` | start/stop/pause/split の瞬間イベント |
| `metricsSummary` | calories・distance・steps・avg HR・HR zone・elevation・VO2max 等の**サマリ集計** |
| `createTime` / `updateTime` | メタ |

**存在しないもの(=筋トレの器が無い証拠):**
- セット × レップ × **重量(load)** の格納先が無い。`metricsSummary` は有酸素寄りの集計のみ。
- 基盤の Health Connect では `ExerciseSegment` が `segmentType`(例 BENCH_PRESS)+ `repetitions` を持つが、**重量フィールドは無く**、しかも GH v4 REST の `exercise` データポイントには segments 相当すら露出していない(`splits` は距離/時間/カロリー区切りのみ)。
- RPE・セット種別(ウォームアップ/メイン/ドロップ)・レスト時間に対応する一切のフィールドが無い。
- 重量/レップの構造化された目標は Health Connect の `PlannedExerciseSessionRecord` / `ExerciseCompletionGoal.RepetitionsGoal` 等にあるが、これは**「計画(training plan)」側**であり、実績ログの台帳でもなく、GH v4 REST の書き込み導線としても本アプリの用途には合わない。

→ 結論として **二層構造が唯一妥当**:

- **Layer 1 (D1, source of truth):** セット/レップ/重量/RPE/セット種別/レスト/種目メタ。本アプリが authoring 元。
- **Layer 2 (GH, projection):** D1 のワークアウト1件 → GH `exercise` ログ1件として「サマリ」を push(`exerciseType=STRENGTH_TRAINING`、`displayName`、`activeDuration`、開始時刻、推定 `calories`、`notes` に逆引きキー)。GH は「運動した事実とカロリー収支」を体重/睡眠と統合して見るための投影先であって、筋トレの真実の保管庫ではない。

体重・睡眠など**センシングデータは逆方向**(GH が source of truth、デイリーバッチで D1 へ吸い上げ)。これは brief の source-of-truth 方針と一致する。

出典: [Package google.devicesandservices.health.v4](https://developers.google.com/health/reference/rpc/google.devicesandservices.health.v4) / [users.dataTypes.dataPoints (REST v4)](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints) / [Google Health API data types](https://developers.google.com/health/data-types) / [Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types) / [ExerciseCompletionGoal.RepetitionsGoal](https://developer.android.com/reference/android/health/connect/datatypes/ExerciseCompletionGoal.RepetitionsGoal)

---

## A. 筋トレ・ボディメイクの D1 データモデル

### A-1. エンティティ関係(概念図)

```
muscle_group (部位マスタ ~12-16行, 固定プリセット)
      ▲ (many-to-many via exercise_muscle, role=primary/secondary)
      │
exercise (種目マスタ: 名称/器具/カテゴリ/可動/一側性)
      ▲ 1
      │ N
workout_set ── N:1 ── workout_exercise ── N:1 ── workout_session
   (1セット=1行:          (セッション内の              (1トレ=1行)
   重量/レップ/RPE/         種目エントリ。              ├─ gh_sync_state (1:1) GH同期台帳
   セット種別/レスト)        order/superset)             └─ derived: volume/duration

workout_template ──< template_exercise ──< template_set  (テンプレ。実績と同形だが値は「目安」)
exercise_favorite (種目お気に入り)
personal_record (PR台帳: exercise × rep域 × 種別)  ← workout_set からトリガ更新

body_metric_daily (体重/体脂肪/睡眠/HRV等。GH吸い上げ + 手動。日次)
nutrition_log + nutrition_preset (食事。本アプリ authoring、GHへ push)
```

### A-2. 主要テーブル定義

設計判断は brief の要件(kg/lb 両表示=#8、編集/削除UI=#4、ヒートマップ=#7)を満たすことを優先。

#### `muscle_group`(部位マスタ / シードデータ固定)
ヒートマップの解剖学的単位。前後・左右対称を区別できる粒度で持つ(ヒートマップ描画に必須)。
| 列 | 型 | 備考 |
|---|---|---|
| id | TEXT PK | `chest`, `lats`, `traps`, `front_delts`, `side_delts`, `rear_delts`, `biceps`, `triceps`, `forearms`, `abs`, `obliques`, `quads`, `hamstrings`, `glutes`, `calves`, `lower_back` 等 |
| name_ja / name_en | TEXT | 表示名 |
| region | TEXT | `upper_push`/`upper_pull`/`legs`/`core` 等の上位カテゴリ(週間ボリューム集計の粗粒度用) |
| body_side | TEXT | `front`/`back`(ヒートマップ前面/背面切替) |
| svg_region_id | TEXT | フロントの人体SVGのパスID対応(描画密結合を避けるためマスタに保持) |

> 設計判断: 部位を「胸/背中/脚」のような粗い粒度ではなく「side_delts と rear_delts を分離」する細粒度にする。理由: ボディメイク本気勢の弱点部位特定(例: rear_delts は週ボリューム不足になりがち)に value が出るため(#5)。トレードオフ: 種目→部位マッピングのシードデータ作成コストが増える。許容。

#### `exercise`(種目マスタ)
| 列 | 型 | 備考 |
|---|---|---|
| id | TEXT PK | ULID |
| name_ja / name_en | TEXT | |
| category | TEXT | `compound`/`isolation` |
| equipment | TEXT | `barbell`/`dumbbell`/`machine`/`cable`/`bodyweight`/`smith`/`band` |
| movement_pattern | TEXT | `horizontal_push`/`vertical_pull`/`hinge`/`squat`/`lunge`/`carry`/`isolation` |
| laterality | TEXT | `bilateral`/`unilateral`(片側種目はボリューム計算で ×2 する) |
| is_bodyweight | INT(bool) | 自重種目フラグ(1RM/ボリューム計算で体重加算するか) |
| default_rep_range | TEXT | プレフィルのヒント(例 `8-12`) |
| gh_exercise_type | TEXT | GHへ push する際の `exerciseType` enum(基本 `STRENGTH_TRAINING`、有酸素種目は個別マップ) |
| is_custom | INT(bool) | ユーザー追加種目か(#4の編集/追加UI) |
| created_at | INT | |

#### `exercise_muscle`(種目↔部位 多対多 + 効き係数)
ヒートマップとボリューム集計の心臓部。
| 列 | 型 | 備考 |
|---|---|---|
| exercise_id | TEXT FK | |
| muscle_group_id | TEXT FK | |
| role | TEXT | `primary`(主働筋) / `secondary`(協働筋) / `stabilizer`(任意) |
| contribution | REAL | 0.0–1.0 の効き係数。primary=1.0 既定、secondary=0.5 既定、stabilizer=0.25。種目ごとに上書き可(例: RDL の hamstrings=1.0 / glutes=0.7 / lower_back=0.4) |
| PK | (exercise_id, muscle_group_id) | |

> 設計判断: role を enum で持ちつつ、別途連続値 `contribution` を持つ二重持ち。理由: ヒートマップ強度(C節)を「primary=フル/secondary=減衰」の単純2値だけでなく、種目特性に応じた微調整(例 RDL のハム vs 腰)を可能にするため。デフォルト値があるので入力負荷は低い。

#### `workout_session`(ワークアウトセッション = GH同期の単位)
| 列 | 型 | 備考 |
|---|---|---|
| id | TEXT PK | ULID。**この id を GH `notes` に埋め込み相互参照**(B節) |
| started_at / ended_at | INT(epoch ms) | GH `interval` に投影 |
| title | TEXT | 例「Push Day A」(テンプレ由来 or 自由) |
| template_id | TEXT FK nullable | 由来テンプレ |
| notes | TEXT | |
| bodyweight_kg | REAL nullable | そのトレ当日の体重(自重種目1RM・カロリー推定に使用。`body_metric_daily` から自動プレフィル可) |
| total_volume_kg | REAL | 派生値だが**非正規化キャッシュ**(後述) |
| active_duration_sec | INT | 派生(GH push 用) |
| est_calories | INT nullable | METs推定(B-4) |
| status | TEXT | `in_progress`/`completed`(リアルタイム記録UIのため) |
| created_at / updated_at | INT | |

#### `workout_exercise`(セッション内の種目エントリ)
| 列 | 型 | 備考 |
|---|---|---|
| id | TEXT PK | |
| session_id | TEXT FK | |
| exercise_id | TEXT FK | |
| order_index | INT | UI並び順 |
| superset_group | INT nullable | 同値はスーパーセット |
| notes | TEXT | |

#### `workout_set`(1セット = 1行。最も多い行)
| 列 | 型 | 備考 |
|---|---|---|
| id | TEXT PK | |
| workout_exercise_id | TEXT FK | |
| set_index | INT | 種目内のセット番号 |
| set_type | TEXT | `warmup`/`main`/`drop`/`backoff`/`amrap`/`failure` |
| weight_kg | REAL | **正規化の単一基準は kg**(下記判断) |
| reps | INT | |
| rpe | REAL nullable | 6.0–10.0(0.5刻み)。RIR派生可 |
| rest_sec | INT nullable | 直前セットからのレスト |
| is_completed | INT(bool) | 計画セットの消化フラグ(テンプレプレフィル時) |
| performed_at | INT nullable | セット完了時刻(レスト/intraday HR突合用) |

> **重量の単位に関する設計判断(#8 kg/lb 両表示):**
> D1 には **kg を単一の正規値として保存**(`weight_kg` REAL)。lb はアプリ層で `kg × 2.20462` を round して表示・入力変換する。**ストレージは1単位に正規化、両単位はプレゼンテーション層**。理由: 二重カラムは不整合の温床。代替案として「入力単位 `entry_unit` を別カラムで保持し、表示は入力時の単位を尊重」する案も検討に値する(プレートの丸め問題: 100kg を lb 表示すると 220.46lb になり、実際に積んだ 225lb と乖離する)。
> **未決事項 D-UNIT-1:** オーナーがジムで主に kg プレートか lb プレートか。lb 環境主体なら `entry_unit` 保持 + lb 正規値も検討。要ヒアリング。暫定は kg 正規 + `entry_unit` カラムだけ用意(将来の丸め忠実化の逃げ道)。

#### `personal_record`(PR台帳)
| 列 | 型 | 備考 |
|---|---|---|
| id | TEXT PK | |
| exercise_id | TEXT FK | |
| record_type | TEXT | `e1rm`(推定1RM最大)/ `weight_at_reps`(各rep域の最大重量)/ `max_reps_at_weight` / `max_volume_session` |
| rep_bucket | INT nullable | weight_at_reps 用(1,3,5,8,10,12…) |
| value | REAL | |
| unit | TEXT | `kg` |
| achieved_set_id | TEXT FK | 達成したセット |
| achieved_at | INT | |

### A-3. 派生指標の計算定義(アプリ層で計算、一部キャッシュ)

- **セットボリューム** = `weight_kg × reps`(自重種目は `(bodyweight_kg × bw_factor + weight_kg) × reps`、加重なしは `bodyweight_kg × reps`)。`laterality=unilateral` は ×2。
- **セッション総ボリューム** `total_volume_kg` = Σ(main + drop + backoff + amrap + failure のボリューム)。**ウォームアップは既定で除外**(過大評価を防ぐ)。`workout_session.total_volume_kg` に書き戻し(D1の集計クエリ高速化。SQLite/D1 はウィンドウ集計が遅くなりがちなので非正規化を許容)。
- **推定1RM(e1RM)**: 既定 **Epley** `1RM = w × (1 + reps/30)`。代替に Brzycki `w × 36/(37−reps)`。
  - 設計判断: reps が 12 を超えると Epley の誤差が増大するため、**reps ≤ 12 のセットのみ e1RM 計算対象**。13rep 以上は PR 検知から除外(or 参考値)。
  - 設定で式を切替可能(`settings.e1rm_formula`)。
- **プログレッシブオーバーロード追跡**: 種目×rep域ごとの時系列で「e1RM の傾き」「同一 rep×重量での RPE 低下(=楽になった)」を検出。詳細は E節。

---

## B. D1 ↔ Google Health 二層同期規約(中核)

### B-1. 同期方向のマトリクス

| データ | source of truth | 方向 | 頻度 |
|---|---|---|---|
| ワークアウト詳細(set/rep/weight/RPE) | **D1** | D1のみ(GHへは投影せず) | — |
| ワークアウト**サマリ**(STRENGTH_TRAINING 1件) | D1 | D1 → GH push | セッション completed 時 + 編集/削除時 |
| 食事 | **D1**(本アプリ authoring) | D1 → GH push | 登録/編集/削除時 |
| 体重・体脂肪 | **GH**(センシング) | GH → D1 pull | デイリーバッチ + 手動入力時は双方向 |
| 睡眠・HRV・SpO2・安静時心拍・皮膚温・VO2max | **GH** | GH → D1 pull(読み取り表示用) | デイリーバッチ |
| トレ中 intraday 心拍 | **GH** | GH → D1 pull(任意、セッション時間窓で) | オンデマンド |

### B-2. 相互参照ID(双方向の紐付け)

GH の `exercise` データポイントは作成時に GH 側 ID(`name`/dataPoint id)が返る。これを D1 に保存し、逆に D1 の session id を GH `notes` に機械可読タグで埋める。

`gh_sync_state`(workout_session と 1:1。同食事用に `nutrition_log` にも同形の列を持たせる)
| 列 | 型 | 備考 |
|---|---|---|
| session_id | TEXT PK FK | |
| gh_datapoint_id | TEXT nullable | GH が返した data point resource name(`users/.../dataPoints/...`) |
| gh_data_origin | TEXT | 書き込んだ dataSource/origin 識別(reconcile 時に自分の書込みを判別) |
| sync_status | TEXT | `pending`/`synced`/`failed`/`stale`/`deleted_remote` |
| last_pushed_hash | TEXT | push したサマリ payload の content hash(差分検知。無駄な PATCH 抑制) |
| last_pushed_at | INT | |
| retry_count | INT | |
| last_error | TEXT | |

GH 側 `notes` への埋め込み規約(往復同定の冗長化):
```
notes = "<ユーザーメモ>\n\n[ghsidecar:session=<ULID>;v=1]"
```
理由: GH の data point が万一 ID 不一致(reconcile で別 origin に統合される等)を起こしても、`notes` のタグで逆引きできる二重化。タグは正規表現で剥がして表示。

### B-3. CRUD 伝播ルール(編集/削除の伝播)

すべて **D1 を先に確定 → GH を best-effort 非同期反映**(GH はネットワーク/レート/breaking change リスクがあるため、ユーザー操作をブロックしない)。

| D1 操作 | GH への伝播 |
|---|---|
| session を `completed` 化 | `dataPoints.create`(exercise)。返却 ID を `gh_sync_state` へ。失敗時 `pending` で再試行キュー |
| session のサマリに影響する編集(時間/種目構成変更でカロリー/duration変化) | `last_pushed_hash` と比較 → 差分あれば `dataPoints.patch`。GH ID 欠落なら create にフォールバック |
| set 単体の編集(重量/レップのみ) | サマリ(duration・推定kcal)が変わらなければ **GH 反映不要**(D1のみ)。変わるなら patch |
| session 削除 | GH `dataPoints.batchDelete`(該当 datapoint id)。成功で行削除、失敗で `sync_status=deleted_remote` にして後追い |
| GH 側で別アプリがそのログを削除/改変(reconcile 検知) | D1 は source of truth なので**D1優先**。バッチで「GHに存在すべきものが消えた」を検知したら再push(=GHを修復)。逆にGH側の手入力 STRENGTH_TRAINING は D1 に取り込まない(D1がauthoring元のため二重計上回避) |

> 設計判断(競合解決): ワークアウトとサマリは **常に D1 が勝つ(last-writer = D1)**。GH は投影先。これにより双方向マージの複雑性を排除。トレードオフ: 消費者向け Google Health アプリ(Geminiコーチ)上で筋トレログを編集しても本アプリには反映されない。許容(本アプリが唯一の編集UI、という割り切り。brief の #3「完全に自分用」と整合)。

> 再試行設計: `gh_sync_state.sync_status=pending/failed` をデイリーバッチ + セッション完了時の即時試行で掃く。GH v4 は "actively evolving"(5/26 にも breaking change)ため、**push失敗は許容される設計**(D1が真実なので GH 欠落は表示上の問題に留まる)。Cloudflare Cron Trigger でバッチ実行。

### B-4. 消費カロリー推定(METs)

GH に push する `est_calories` の算出。筋トレは GH 側でカロリーを自動算出してくれない(`metricsSummary.calories` は心拍/デバイス由来で、手動 exercise ログには付かない可能性が濃厚)ので **アプリ側で MET 推定**する。

- 基本式: `kcal = METs × 3.5 × bodyweight_kg / 200 × duration_min`
- MET 値(`exercise.met_value` or セッション強度から):
  - 一般的レジスタンストレーニング(中強度) ≈ **5.0 METs**(Compendium of Physical Activities: vigorous effort)
  - 軽め/マシン主体 ≈ 3.5、高強度サーキット ≈ 6.0
- `duration` は `active_duration_sec`(レスト込みの総時間 or 実働。**未決事項 B-CAL-1**: GH へは「セッション総経過時間」を duration として送るのが自然だが、カロリーは実働ベースが正確。暫定: GH の `interval`/`activeDuration` には総経過、`est_calories` は METs×総経過の保守的推定で送る。精緻化は後回し)。
- 設計判断: カロリーは**あくまで推定**で、体重(GH source of truth)との収支ビュー用の参考値。精度より「過大評価しない」を優先。

---

## C. 部位ヒートマップ集計ロジック(#7)

セット/ボリューム → 部位別 intensity(0–1) → SVG 人体ヒートマップの色強度へマップ。

### C-1. 部位別「効きスコア」 stimulus score

直近 N 日(既定 **N=7**、UI で 7/14/28 切替)の各セットを、対象部位ごとに重み付け加算:

```
stimulus(muscle, window) =
  Σ_set [ effective_volume(set)
          × contribution(exercise, muscle)      // A-2 の係数(primary≈1.0 / secondary≈0.5)
          × set_type_weight(set.set_type)        // warmup=0.3, main=1.0, drop/backoff=0.8, failure=1.1
          × recency_decay(days_ago, window) ]    // 直近ほど重い減衰窓
```

- `effective_volume(set)` = ボリューム(weight×reps)。重量ゼロ自重は reps を擬似ボリューム化(`bodyweight×reps×bw_factor`)。
- `recency_decay`: 半減期ベースの指数減衰 `exp(-ln2 × days_ago / half_life)`、`half_life ≈ window/2`(7日窓なら3.5日)。理由: 「昨日胸を追い込んだ」は今日のヒートマップで濃く、6日前のは薄く。これは**回復/超回復の可視化**に近く、ボディメイク的に意味がある(#5の価値)。
- 代替案: 単純な「窓内合計(減衰なし)」。週間ボリューム管理(下記C-3)には減衰なし合計が正しいので、**ヒートマップ=減衰あり / 週間ボリューム表=減衰なし合計**で使い分ける。

### C-2. intensity への正規化(色マップ)

stimulus は絶対値なので部位間・期間で比較するには正規化が要る。二段構え:

1. **相対正規化(既定)**: その窓内の全部位 stimulus の分布で min-max もしくは 95 パーセンタイル基準にスケール。「今週どこを多くやったか」のヒートマップ。
2. **目標基準正規化(上級)**: 部位ごとの「週間目標セット数 or ボリューム」を `muscle_volume_target` に持ち、`intensity = actual / target`(1.0=目標達成、>1赤、<0.5青)。**弱点部位の可視化**に直結(#5)。科学的目安として「中級者は部位あたり週 10–20 セット」を初期 target に。

色マップは intensity 0→1 を青(不足)→緑→黄→赤(高刺激/オーバーリーチ)へ。`muscle_group.svg_region_id` で SVG パスへ流し込む(前面/背面トグル)。

> 設計判断: ヒートマップは「直近の刺激の濃さ」と「週間ボリューム充足度」の2モードを持つ。前者は回復管理、後者は計画管理。混同しないようUIでモード明示。

### C-3. 部位別週間ボリューム(派生ビュー)

`muscle_group` × ISO週 で `Σ(セット数)` と `Σ(effective_volume × contribution)` を集計。`region`(upper_push 等)で roll-up。MEV/MAV/MRV(最小有効/最大適応/最大回復可能ボリューム)の帯を重ねた棒グラフが価値(E節)。

---

## D. プリセット / テンプレート(#4, #5)

### D-1. ワークアウトテンプレート(PPL 等)

実績テーブルと**同形だが値が「目安」**の階層を別系統で持つ(実績で汚さない)。
- `workout_template`(id, name 例「Push A」, description, region_focus)
- `template_exercise`(template_id, exercise_id, order_index, target_sets, superset_group)
- `template_set`(template_exercise_id, set_index, target_weight_kg nullable, target_reps, target_rpe, set_type)

セッション開始時に template から `workout_session`/`workout_exercise`/`workout_set`(is_completed=0)を materialize。

### D-2. 前回値プレフィル

新規セット入力時、`workout_set` を `exercise_id` で時系列降順に引き、**直近同種目の同 set_index の値**(weight/reps/RPE)を入力欄にプレフィル。プログレッシブオーバーロードの最重要 UX(#5)。クエリ最適化のため `workout_set` に `(exercise_id, performed_at)` の複合インデックス。

### D-3. 種目お気に入り
`exercise_favorite(exercise_id, pinned_at, last_used_at)`。種目選択 UI の上位表示。

### D-4. 食事プリセットを KV → D1 へ移すか

**移す(D1化)を推奨。** 根拠:
- 既存 fitbit-mcp では Fitbit Create Food API が PFC を silent drop するため KV に preset を持つ**ワークアラウンド**だった。
- GH v4 では nutrition 書き込みが 2026-05-26 解禁され、PFC を構造化して送れる見込み(`googlehealth.nutrition.writeonly`)。→ **PFC保持のための KV preset の存在理由が消える**。
- 本アプリは既に D1 を持ち、食事も D1 authoring。プリセット・食事ログ・ワークアウトを同一 D1 でクロス集計したい(E節「体重×PFC×トレ相関」)ため、KV 分散は不利。
- KV はバックアップ・スキーマ進化・関係クエリに弱い。

`nutrition_preset`(id, name, items_json or 正規化、protein_g/fat_g/carb_g/kcal, meal_type, last_used_at)。`nutrition_log`(id, logged_at, meal_type, source `manual`/`photo`/`preset`, PFC, kcal, gh_sync_state)。
- **移行未決事項 D-MEAL-1:** 既存 KV(`preset:` prefix)の中身を新 D1 へ一度だけ移送するスクリプトが要る。KV→D1 マイグレーションは別タスクで。
- トレードオフ: D1 行数増。単一ユーザーなので無視できる。

---

## E. ガチ勢に価値が出る派生指標・ビュー(#5)

1. **部位別週間ボリューム + MEV/MAV/MRV帯**(C-3): 棒グラフに「最小有効/最大適応/最大回復可能」の帯を重ね、過不足を一目で。弱点部位(rear_delts 等)の慢性不足を検出。
2. **PR更新検知 & タイムライン**: セット保存時に `personal_record` をトリガ更新。e1RM PR / rep-PR / volume-PR を分けて検知し、達成時にトースト + PWA プッシュ通知。PR の時系列を種目別に折れ線で。
3. **プログレッシブオーバーロード・トレンド**: 種目×rep域の e1RM 回帰直線(傾き = 週あたり伸び)。停滞(傾き≈0が3週)を検知して「デロード提案」。同一 weight×reps での **RPE 低下**も「強くなった」シグナルとして可視化。
4. **体重 × PFC × トレーニングの相関ビュー**(統合の真価): 横軸=時間で、(a) 体重(GH pull)、(b) 日次 PFC・総kcal(D1食事)、(c) 週間総トレボリューム(D1)、(d) 推定消費kcal を重ねる。増量/減量フェーズで「ボリューム維持できているか(=筋量維持シグナル)」「体重トレンドvsカロリー収支」を判断。これは GH 単体でも既存MCP単体でも作れない、**二層統合だからこそ**のビュー。
5. **回復・レディネス指標**: GH pull の HRV / 安静時心拍 / 睡眠と、直近トレ刺激(C-1 stimulus)を並べ、オーバーリーチ警告。皮膚温は GH では絶対℃(Fitbit相対と異なる)なので扱いに注意。
6. **ボリューム/強度バランス**: 高レップ(代謝的ストレス)vs 高重量(機械的張力)の比率を部位別に。偏りの是正提案。
7. **セッション密度**: 総ボリューム / セッション時間(レスト効率)。時短トレの質トラッキング。

---

## F. 未決事項(レビュアー判断が必要)

| ID | 内容 | 暫定方針 |
|---|---|---|
| D-UNIT-1 | ジムのプレートが kg か lb か(丸め忠実度に影響) | kg正規 + `entry_unit` カラムだけ先置き |
| B-CAL-1 | GH `duration` を総経過/実働どちらで送るか | 総経過を送る、kcalは保守推定 |
| B-RECON-1 | GH `:reconcile` を使い自分の書込みを `dataOrigin` で判別する具体手順は GH v4 が evolving なため実装時に再検証 | data_origin を記録し fail-safe |
| GH-SCOPE-1 | exercise 書き込みは `googlehealth.activity_and_fitness`(writeonly 分割後の正確なスコープ名)を実装時確認。weight/sleep は 2026-03-24、nutrition は 5/26 解禁済 | 実装着手時に scope 名を最終確認 |
| D-MEAL-1 | 既存 KV meal preset の D1 移送スクリプト | 別タスク |
| C-TARGET-1 | 部位別週間ボリューム目標値の初期セット(週10–20セット等) | 中級者デフォルトをシード、UIで調整 |
| GH-PUSH-1 | そもそも GH に筋トレサマリを push する価値があるか(Geminiコーチや体重統合表示のため)。push しない「D1完結」も選択肢 | push する。ただし best-effort・D1優先で疎結合に |

## G. レビュー観点まとめ(要点の再確認)

- **二層構造は仮説でなく確定**: GH v4 `exercise` データポイントに set/rep/weight/RPE/set-type の器が無いことを公式リファレンスで検証済み(`exerciseType`/`displayName`/`splits`(距離・時間・カロリー区切りのみ)/`metricsSummary` のみ)。よって筋トレ詳細は D1 が source of truth、GH へはサマリ投影、が唯一妥当。
- **競合解決は D1-wins**(投影先 GH は best-effort)。双方向マージを避け、単一ユーザー前提で割り切り。
- **重量は kg 単一正規化 + 表示変換**。lb プレート丸め問題のため `entry_unit` の逃げ道を残す。
- **ヒートマップは contribution 係数 × set_type 重み × 指数減衰**で stimulus を出し、相対/目標基準の2モードで正規化。
- **食事プリセットは KV→D1 へ移す**(GH nutrition 書込み解禁で KVワークアラウンドの存在理由が消滅)。
- 最大の差別化ビューは **体重(GH)× PFC(D1)× トレボリューム(D1)の統合相関** で、これは二層統合の正当化そのもの。

(リポジトリ状態: `/Users/yuto/Workspace/tachibanayu24/google-health-sidecar` は現状 `.design-workflow.js` のみ、git 未init。本ドキュメントはコード生成前の設計フェーズ成果物。)

---

# research:mcp-migration

The facts in the task context align with current public information, with one nuance worth flagging: the public docs still show write scopes as in-flux / partially gated, which reinforces the "actively evolving, design for both providers" stance. I have enough to write a defensible design doc. Producing it now.

---

# 設計書: 既存MCP統合・移行戦略 と モノレポ構成

google-health-sidecar / 単一ユーザー向けボディメイク sidecar アプリ
作成日: 2026-05-31 / 対象: 普段使いのClaudeアプリ(コードベース非参照)によるレビュー

---

## 0. この文書の前提とスコープ

本文書は新規 repo `google-health-sidecar`(現状ほぼ空・git未init)に対する、以下6点の設計判断を扱う。

1. 旧 `fitbit-googlehealth-mcp`(別repo)資産の「持ち込み / 作り替え / 廃棄」仕分け
2. UI(PWA)・MCPサーバー・Cron batch の3面でコア層を共有するモノレポ構成
3. 食事・ワークアウト書き込み経路の一本化(UI/MCP どちらからでも同一ドメインサービス経由)
4. UI 時代における MCP の位置づけと責務分担
5. 段階的移行ロードマップ(新立ち上げ→並行→旧廃止、Fitbit→GH切替の9月期限)
6. 単一ユーザー前提のセキュリティ整理(UIゲート / MCP保護 / トークン保管)

レビュアーが背景を持たない前提で、各判断に**根拠・代替案・トレードオフ・未決事項**を明示する。

### 0.1 検証済みの外部事実(2026-05-31時点)

- Fitbit Web API は **2026-09 に旧エンドポイント decommission・データ同期停止**。新規連携の推奨ローンチ目標は 5月末。現在は dual-run window。([Fitbit Community](https://community.fitbit.com/t5/Web-API-Development/Introducing-the-next-phase-of-the-Fitbit-Web-API/td-p/5821061), [Thryve](https://www.thryve.health/blog/fitbit-api-deprecation))
- 後継 Google Health API v4 は `health.googleapis.com/v4`、`users.dataTypes.dataPoints` に `list / reconcile / create / patch / batchDelete / rollUp / dailyRollUp` を集約。**スコープは `.readonly` / `.writeonly` 分割へ移行中**で、write scope はデータ種別ごとに段階解禁の最中(nutrition/hydration/weight など logging 用途が優先)。API は GA前で "actively evolving"、breaking change が継続。([Google Health Scopes](https://developers.google.com/health/scopes), [Google Health Endpoints](https://developers.google.com/health/endpoints), [tryterra guide](https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api))
- Google OAuth 2.0 が Fitbit Auth を置換。**同意画面を "In production" に publish しないと refresh token が7日失効**(無人Worker refresh が壊れる)。単一ユーザーなら未verified-production のまま長命トークン可。

> **設計含意(最重要)**: GH API v4 は今日もまだ動く標的。`HealthProvider` 抽象を捨てず、**Fitbit と GH を差し替え可能に保つこと**が9月期限・breaking change 両方へのヘッジになる。後述の全判断はこの一点に従属する。

---

## 1. 旧 fitbit-googlehealth-mcp 資産の仕分け

要件6「既存MCPとの互換性はそこまで考えなくていい」を、**「MCPツールの I/O 契約は維持しなくてよい(=Claude.aiの既存接続が壊れて構わない)」が、設計資産・知見は最大限再利用する**と解釈する。プロトコル互換ではなくコード資産の再利用を狙う。

### 1.1 仕分け表

| 資産 | 判断 | 根拠・補足 |
|---|---|---|
| `HealthProvider` インターフェース(read+write 群) | **持ち込み(コア化)** | 移行戦略の心臓。Fitbit→GH 切替の単一接合点。`packages/core` のドメイン境界として昇格させる |
| `FitbitProvider` 実装 | **持ち込み(暫定維持)** | 9月まで稼働中。dual-run の read 源・移行検証の基準。9月以降は削除候補 |
| `GoogleHealthProvider`(未実装) | **新規実装** | 本プロジェクトの主目的。v4 `dataPoints` 集約 + `.writeonly` スコープ前提で新規 |
| Zod データモデル(Profile/SleepLog/WeightLog/FoodLog/HRV 等) | **持ち込み(再編)** | 検証済み資産。ただし「**ドメインモデル**(アプリ内部・D1スキーマ準拠)」と「**プロバイダDTO**(Fitbit/GH各APIの形)」に**二層分離**して持ち込む(現状は Fitbit形が混在)。`MealType` enum 等はそのまま流用 |
| OAuth Pattern B(CLIで1回取得→保管→Worker自動refresh) | **持ち込み(GH化)** | パターンは生存。Fitbit OAuth → Google OAuth に置換、refresh ロジック流用。失効60s前refreshの方針も流用 |
| レート制限 / キャッシュ(TTL1h) / エラー処理 | **持ち込み(再配置)** | コア層 or provider層のユーティリティとして流用。読み取りキャッシュは batch/UI でも有用 |
| 食事 preset(KV `preset:` prefix ワークアラウンド) | **作り替え(D1へ昇格)** | Fitbit Create Food の PFC silent drop 回避策。GH nutrition write は PFC を素直に持てる見込み → **KVワークアラウンドは不要化**。preset 自体は有用機能なので D1 テーブルに正式モデル化して残す |
| MCPツール33個の I/O 契約 | **作り替え(D1経由に再実装)** | §3/§4参照。直 API 叩きから「ドメインサービス経由」に再配線。ツール本数は UI と役割分担して削減 |
| `log_meal_photo`(写真→items[]→ログ化) | **持ち込み(主役級)** | MCP残存の最大の価値。Claudeの視覚解析はUIで代替困難。ドメインサービス経由に再配線して維持 |
| `@hono/mcp` + MCP SDK + Streamable HTTP(stateless) | **持ち込み** | モバイル必須。MCPサーバー Worker でそのまま流用 |
| MCP保護(URL埋め込みsecret + Anthropic CIDR allowlist) | **持ち込み** | §6参照。MCP面ではこの方式を継続 |
| KV `TOKENS` / `CACHE` namespace | **一部廃止・一部D1へ** | TOKENS は KV 継続可(§6で論点化)。CACHE のうち preset は D1 へ。read キャッシュは KV 継続でよい |
| biome / vitest / wrangler / pnpm | **持ち込み** | ツールチェーンはそのまま。pnpm workspace でモノレポ化 |
| Claude.ai Custom Connector 登録(OAuthなし) | **作り替え** | 新MCP Worker の新URLで再登録。旧接続は廃止 |

### 1.2 捨てるもの(明確に)

- **旧 repo の MCPツールの後方互換**: 維持しない。新URL・新ツール定義で再接続する(要件6の割り切り)。
- **Fitbit食事 PFC KVワークアラウンドの恒久化**: GH移行で不要化を狙う。ただし「GH write scope が9月までに nutrition で安定するか」が未決(§7)なので、ワークアラウンド相当のロジックは provider 内に隔離して残せる形にする。

---

## 2. モノレポ / ディレクトリ構成

### 2.1 Worker 同居か分離か → **「コアは共有パッケージ、デプロイは2 Worker + 1 Pages」**

3つの実行面(UI / MCP / Cron)はランタイム特性・スケール・セキュリティ境界が異なる。

| 実行面 | 特性 | デプロイ単位の判断 |
|---|---|---|
| UI(PWA) | 静的アセット + APIルート。Googleログインゲート | **Worker(SSR/APIフルスタック)**。Next.js等を載せるなら Pages ではなく Worker assets + Hono API |
| MCP サーバー | stateless Streamable HTTP。secret+CIDRで保護。Claude.ai から叩かれる | **独立 Worker**。セキュリティ境界が UI と全く違う(CIDR allowlist を UI に巻き込みたくない) |
| Cron batch | scheduled handler。体重/睡眠を GH から吸い上げ→D1 | **MCP Worker か UI Worker に相乗り**(`scheduled` ハンドラ追加)。専用Worker不要 |

**結論**: コア(provider層・ドメインサービス・D1アクセス・Zod型)は **`packages/core` 共有パッケージ**。実行面は **`apps/web`(UI Worker, cron相乗り)** と **`apps/mcp`(MCP Worker)** の **2デプロイ**。両 Worker が `packages/core` を import し、同一 D1 / KV にバインドする。

- **2 Worker にする根拠**: ① MCP の CIDR allowlist / secret 認証を UI のGoogleログインと混ぜない(認証モデルが別)。② Claude.ai の MCP トラフィックと PWA トラフィックを独立スケール・独立デプロイしたい。③ MCP の breaking change デプロイで UI を巻き込まない。
- **Cron を専用Workerにしない根拠**: 単一ユーザー・日次バッチで負荷極小。`apps/web` の `scheduled` に相乗りさせ運用面を減らす。バッチが重くなれば後で分離可能(コアが共有なので分離コストは低い)。
- **代替案**: 全部1 Worker 同居(ルーティングで分岐)。— 却下。secret+CIDR 保護のMCPと公開UIを同一Workerに同居させると、CIDR allowlist の適用ミス1つでMCPが露出する。境界を物理分離する方が単一ユーザーでも安全側。
- **代替案**: 3 Worker 完全分離。— 却下。cron専用Workerは運用オーバーヘッドに見合わない。

### 2.2 ディレクトリツリー

```
google-health-sidecar/
├─ pnpm-workspace.yaml
├─ package.json                      # workspace root, biome/vitest 設定
├─ biome.json
├─ tsconfig.base.json
├─ .design-workflow.js               # 既存(設計ワークフロー用、触らない)
│
├─ packages/
│  └─ core/                          # ★ 3面が共有する唯一のドメイン層
│     ├─ package.json
│     ├─ src/
│     │  ├─ domain/                  # ドメインモデル(D1スキーマ準拠・provider非依存)
│     │  │  ├─ models.ts             # WorkoutSession, SetRecord, MealEntry, WeightEntry...
│     │  │  ├─ enums.ts              # MealType, MuscleGroup, Equipment, Unit(kg/lb)
│     │  │  └─ schema.zod.ts         # Zod(旧repoのZod型を二層分離して再編)
│     │  ├─ providers/               # ★ HealthProvider 抽象 + 実装(旧repoから移行)
│     │  │  ├─ HealthProvider.ts     # interface(read+write)
│     │  │  ├─ fitbit/               # FitbitProvider(暫定維持、9月で削除候補)
│     │  │  ├─ google-health/        # ★ GoogleHealthProvider(v4 dataPoints)新規
│     │  │  │  ├─ client.ts          # health.googleapis.com/v4 ラッパ
│     │  │  │  ├─ mappers.ts         # domain ↔ GH DTO 変換(intraday downsample等)
│     │  │  │  └─ scopes.ts          # .readonly/.writeonly スコープ定義
│     │  │  └─ dto/                  # provider別DTO Zod(domainと分離)
│     │  ├─ services/                # ★ ドメインサービス(書き込み経路の一本化点)
│     │  │  ├─ WorkoutService.ts     # log/edit/delete workout → D1 + GH push
│     │  │  ├─ NutritionService.ts   # log meal/preset → D1 + GH push(PFC保持)
│     │  │  ├─ BodyService.ts        # weight/body-fat(authoring=GH吸上 or UI入力)
│     │  │  └─ SyncService.ts        # cron吸い上げ(GH→D1)、突合(reconcile)
│     │  ├─ db/                      # D1 アクセス
│     │  │  ├─ migrations/           # SQL マイグレーション
│     │  │  ├─ repositories/         # WorkoutRepo, MealRepo, PresetRepo, SyncStateRepo
│     │  │  └─ client.ts
│     │  ├─ auth/                    # OAuth Pattern B(Google化)
│     │  │  ├─ tokenStore.ts         # KV TOKENS 読み書き + 失効60s前refresh
│     │  │  └─ googleOAuth.ts
│     │  ├─ presets/                 # 種目→部位マッピング、ヒートマップ用データ
│     │  │  └─ exercise-catalog.ts   # 部位プリセット(要件7)
│     │  └─ util/                    # rate-limit, cache(KV), units(kg↔lb), errors
│     └─ tests/
│
├─ apps/
│  ├─ web/                           # ★ UI(PWA)Worker + cron 相乗り
│  │  ├─ wrangler.jsonc              # D1/KV/TOKENS バインド, Google OAuth secret, triggers.crons
│  │  ├─ src/
│  │  │  ├─ index.ts                 # fetch handler(UI + /api) + scheduled handler
│  │  │  ├─ api/                     # Hono ルート(UI→ドメインサービス呼び出し)
│  │  │  ├─ auth/                    # Googleログインゲート(セッション)
│  │  │  ├─ cron/                    # scheduled: SyncService.dailyPull()
│  │  │  └─ ui/                      # PWA フロント
│  │  │     ├─ components/           # heatmap(人体図), set logger, meal editor
│  │  │     ├─ pwa/                  # manifest.json, service worker
│  │  │     └─ ...
│  │  └─ public/                     # icons, manifest
│  │
│  └─ mcp/                           # ★ MCP サーバー Worker
│     ├─ wrangler.jsonc              # D1/KV/TOKENS, MCP_SHARED_SECRET, CIDR
│     ├─ src/
│     │  ├─ index.ts                 # @hono/mcp Streamable HTTP(stateless)
│     │  ├─ guard.ts                 # secret検証 + Anthropic CIDR allowlist
│     │  └─ tools/                   # MCPツール(D1経由・ドメインサービス呼び出し)
│     │     ├─ read.ts               # get_* (D1 + provider read)
│     │     ├─ write.ts              # log_*(→ WorkoutService/NutritionService)
│     │     ├─ photo.ts              # log_meal_photo(主役)
│     │     └─ preset.ts             # meal preset(→ PresetRepo)
│     └─ tests/
│
└─ tools/                            # CLI(OAuth初回取得スクリプト等、旧repo流用)
   └─ oauth-bootstrap.ts
```

**ポイント**: `apps/web` と `apps/mcp` は **ビジネスロジックを持たない**。両者とも `packages/core/services/*` を呼ぶだけの薄いアダプタ。これが §3「書き込み経路一本化」を構造的に強制する。

---

## 3. 書き込み経路の一本化

### 3.1 原則: 「すべての write は `packages/core/services/*` を1点経由する」

食事・ワークアロウトはこのアプリが authoring 元(source of truth)。UI でも MCP でも、**生の Provider write を直接叩かせない**。必ずドメインサービスを通す。

```
[UI(PWA) /api ルート] ─┐
                        ├─→ WorkoutService.logSession() / NutritionService.logMeal()
[MCP ツール]          ─┘        │
                                ├─ 1) D1 に正本記録(idempotency key 付与)
                                ├─ 2) GoogleHealthProvider.write(...) で GH へ push
                                └─ 3) D1 に GH dataPoint ID / push状態を記録
```

### 3.2 重複・競合の回避

| 課題 | 対策 |
|---|---|
| UI と MCP の二重登録 | サービス層で **idempotency key**(例: `clientGeneratedId` = ローカル生成UUID)を必須化。D1 UNIQUE 制約で二重INSERTを弾く |
| GH push 失敗時の整合性 | **D1 を先に commit → GH push は非同期/リトライ可能**に。`sync_state`(pending/synced/failed)を D1 に持ち、cron でリトライ。GH が "actively evolving" で落ちうる前提の設計 |
| GH 側で編集 → アプリと食い違い | 食事/ワークアウトは **GH 側編集を想定しない(authoring=本アプリ)**。万一の不整合は cron の `reconcile` で検出しログ。GH を勝たせない(本アプリが正本) |
| 体重/睡眠(GH が source of truth) | **逆向き**: cron `SyncService.dailyPull()` が GH→D1 に吸い上げ。UI からの体重手入力は「GH へ push して GH を正本に保つ」= BodyService 経由(authoring=GH に委譲) |
| 編集・削除 | UI/MCP の edit/delete も同一サービス経由。D1 更新 + GH `patch`/`batchDelete` を同一トランザクション論理で。GH 側 dataPoint ID を D1 に保持しているから削除可能 |

### 3.3 source of truth マトリクス

| データ種別 | authoring(書き手) | source of truth | 経路 |
|---|---|---|---|
| ワークアウト(セット/種目) | 本アプリ(UI/MCP) | **D1**(GHはミラー) | Service → D1 → GH push |
| 食事(PFC含む) | 本アプリ(UI/MCP) | **D1**(GHはミラー) | Service → D1 → GH push |
| 体重 / 体脂肪 | GH or 本アプリ手入力 | **GH** | 手入力時: Service → GH push;表示用に cron で D1 へ吸上 |
| 睡眠 / HRV / SpO2 等センシング | デバイス(GH) | **GH** | cron pull → D1(read cache) |

> ワークアウト/食事の source of truth を D1 にする根拠: GH の nutrition/exercise write scope が GA前で不安定(§0.1)。**正本をD1に置けば、GH が落ちても・breaking change が来ても・9月にFitbitが死んでも、アプリの記録は失われない**。GH はあくまで Google Health エコシステム(Gemini Health Coach 等)へ流すためのミラー。

---

## 4. UI 時代における MCP の位置づけ

### 4.1 MCP は残す。ただし役割を絞る

**残す根拠**:
- `log_meal_photo`: 写真を撃つだけで Claude が視覚解析→items[]→栄養推定。**UIで同等体験を作るのは困難**(自前で画像認識を持たない限り)。これがMCP最大の存在価値。
- 自然言語ワークアウト記録: 「ベンチ60kg 10回3セット、ややきつめ」を自然文で投げてログ化。スマホでフォーム入力より速い局面がある。
- 旅行先・移動中など、Claudeアプリだけ開いている状況のフォールバック。

**絞る方針**: UI が登録/編集/削除/可視化(ヒートマップ含む)を担うので、**MCP の Read/Delete 系は最小限に縮小**。

| 旧MCP(33ツール) | 新MCP の扱い |
|---|---|
| Write 7 + Photo | **維持・再配線**(D1経由)。log_meal_photo, log_food, log_meal, log_weight, log_activity 等は NutritionService/WorkoutService/BodyService 経由に |
| Read 16 | **大幅削減**。Claudeが推論に使う最小限(get_daily_summary, get_food_log, get_exercise_list, get_body_log 程度)のみ残す。詳細閲覧はUIへ |
| Delete 6 | **削減 or 維持**。UIで消す前提だが、誤登録の即時取り消し用に log系の取消だけ残してよい |
| Meal preset 4 | **維持・D1化**。list/save/delete/log_preset を PresetRepo 経由に |

### 4.2 MCPツールは D1 経由に作り替えるべきか → **Yes(必須)**

- **Write/Delete**: 必ず `packages/core/services` 経由 = D1正本 + GH push。直叩き禁止(§3一本化の遵守)。
- **Read**: D1(正本/キャッシュ)を一次ソースに。D1にまだ無いセンシングデータ(当日の睡眠等)は provider read にフォールバック。これで Claude と UI が同じ数字を見る。

### 4.3 責務分担表(UI / MCP / Cron)

| 機能 | UI(PWA) | MCP(Claude) | Cron batch |
|---|---|---|---|
| ワークアウト登録 | ◎ 主(セットロガー、部位ヒートマップ) | ○ 自然言語で代替 | − |
| 食事登録 | ○ フォーム/preset選択 | ◎ 写真ログが主役 | − |
| 体重/体脂肪 手入力 | ◎ | △ 可 | − |
| 編集/削除 | ◎ 主 | △ 直近取消のみ | − |
| センシング閲覧(睡眠/HRV/SpO2) | ◎ 可視化 | ○ 推論用に最小read | ◎ GH→D1 吸上 |
| 種目→部位プリセット/ヒートマップ(要件7) | ◎ 専任 | − | − |
| kg/lb 両表示(要件8) | ◎(`util/units`) | ○ ツール応答に両併記 | − |
| GH push リトライ / reconcile | − | − | ◎ |
| トークン refresh | (Workerが自動) | (Workerが自動) | ◎ refresh主体に好適 |

---

## 5. 段階的移行ロードマップ

9月のFitbit停止が hard deadline。「新アプリ立ち上げ → 並行運用 → 旧MCP廃止」と「Fitbit→GH provider切替」を絡める。

```
[M0] 6月: モノレポ基盤 + コア層
  - pnpm workspace / biome / vitest / wrangler 構築、D1作成・マイグレーション
  - packages/core に HealthProvider抽象 + FitbitProvider(旧repoから移植) + Zod二層分離
  - OAuth Pattern B を Google OAuth に置換、同意画面を "In production" publish(7日失効回避)
  - GoogleHealthProvider の read 実装(like-for-like) + intraday downsample
  ▸ マイルストーン: 旧と同じ read が新コアで取れる(Fitbit/GH 両provider で)

[M1] 7月: UI(PWA)MVP + 書き込み経路一本化
  - WorkoutService/NutritionService/BodyService 実装(D1正本 + GH push、idempotency)
  - UI: セットロガー、食事フォーム、体重入力、種目→部位ヒートマップ(要件7)、kg/lb両表示(要件8)
  - Googleログインゲート、PWA manifest/service worker
  ▸ マイルストーン: UI から登録→D1→GH push が通る。GH write scope の実地検証(nutrition/exercise)
  ▸ 7/15: 旧Fitbitアカウント未統合データ削除期限 → 統合済みを確認

[M2] 7〜8月: 新MCP Worker + 並行運用
  - apps/mcp 構築、ツールをD1経由に再実装(log_meal_photo 含む)、secret+CIDR保護
  - Claude.ai に新Custom Connector登録(新URL)
  - 旧MCP と新MCP/UI を並行運用。GH push の整合を cron reconcile で監視
  ▸ マイルストーン: Claudeの写真食事ログが新経路で動作。新旧データ差分ゼロを確認

[M3] 8月: GH provider 完全切替
  - SyncService の pull を GH に切替(体重/睡眠/HRV...)
  - 書き込みも GH を既定 provider に(Fitbit write は停止)
  - GH write scope が nutrition で安定しているか最終確認 → 不安定なら PFC保持を D1正本で吸収(GH側はベストエフォート)
  ▸ マイルストーン: Fitbit に依存しない状態を達成(read/write 共に GH)

[M4] 9月(Fitbit decommission前): 旧廃止
  - 旧 fitbit-googlehealth-mcp Worker を停止・Custom Connector削除
  - FitbitProvider をコアから削除(または dead-code として残置し import解除)
  - 9月のFitbit停止後の挙動を監視(GH単独で問題ないこと)
  ▸ マイルストーン: 単一スタック(GH + D1 + UI + 新MCP)で完全運用
```

**ロールバック余地**: M3まで FitbitProvider をコアに残すので、GH の breaking change で詰まったら一時的に Fitbit read に戻せる(9月まで)。9月以降は GH 一択になるので、それまでに GH の安定性を M1/M2 で十分検証しておくのが肝。

---

## 6. 単一ユーザー前提のセキュリティ整理

ユーザーはオーナー1人。過剰な多テナント設計は不要だが、**「公開URL上に GH 書き込み権限を持つトークンがある」**事実は変わらないので最低限を固める。

### 6.1 認証境界(面ごとに別方式で正解)

| 面 | 保護方式 | 根拠 |
|---|---|---|
| UI(PWA) | **Googleログインゲート** + 許可メール allowlist(`tachibanayu24@gmail.com` のみ) | 要件2/3。Google OIDC でログイン → セッションCookie。メール一致しなければ全拒否 |
| MCP | **URL埋め込み `MCP_SHARED_SECRET` + Anthropic outbound CIDR `160.79.104.0/21` allowlist** | 旧方式継続。Claude.ai は OAuthなしCustom Connector。二重(secret知識 + 送信元IP)で単一ユーザーには十分 |
| Cron | Cloudflare 内部トリガのみ(外部到達不可) | scheduled handler は公開ルートを持たない |

> UI と MCP で認証方式が違うのが、§2.1 で Worker を分離した実務的理由。同一Workerだと「MCP用CIDRチェックを通したいがUIは公開」という矛盾するルーティングを抱える。

### 6.2 GH API トークンの保管: KV か D1 か、暗号化要否

**結論: トークンは KV(`TOKENS`)に継続保管。暗号化は「アプリ層暗号化までは不要、ただし KV を専用namespace + 最小バインドで隔離」**。

| 論点 | 判断 | 根拠 / トレードオフ |
|---|---|---|
| KV vs D1 | **KV** | 単一キー read/write の低レイテンシ、TTL不要の永続、旧repo実装の流用。D1に置く利点(JOIN/トランザクション)はトークンには不要。**ただし refresh の同時実行制御**は Fitbit同様 GH も短時間同一refresh_tokenに同応答を返すか要確認(§7) |
| 保存時暗号化 | **CF管理の at-rest 暗号化に依拠(アプリ層の追加暗号化は当面不要)** | 単一ユーザー・KVはWorker bindingからのみアクセス・publicルート無し。追加暗号化の鍵管理コストが、得られる脅威低減に見合わない。**代替案**: WebCrypto + `secrets` の鍵でKV値を封筒暗号化 → 将来 verification/多端末化する時に導入。今は YAGNI |
| バインド最小化 | **TOKENS namespace は両Workerにバインドするが、書き込みは auth/tokenStore 経由に限定** | トークン触る経路をコード上1ファイルに集約し監査面を絞る |
| refresh 主体 | **cron を主 refresh 主体に**(60s前更新 + 失敗時アラート) | リクエスト駆動refreshだと低頻度アクセス時に7日窓を超えるリスク。cronで能動的に温存。**前提**: 同意画面 "In production" publish 済み(でないと7日失効) |
| MCP_SHARED_SECRET / OAuth client secret | **Wrangler secrets**(コード/wrangler.jsonc に平文で置かない) | 基本 |

### 6.3 単一ユーザーゆえの割り切り(明記)

- マルチテナント・行レベル権限・監査ログの本格運用は**やらない**。D1スキーマに `user_id` を持たせず単一行前提でよい(将来拡張時の負債は受容)。
- CASA verification は不要(100ユーザー超で初めて必要)。未verified-production の長命トークンで運用。

---

## 7. 未決事項 / リスク(レビュアー判断を仰ぐ点)

| # | 未決事項 | 影響 | 暫定方針 |
|---|---|---|---|
| 1 | **GH v4 の nutrition/exercise write scope が9月までに安定GAするか** | 食事PFC・ワークアウト push の可否。不安定なら D1正本+ベストエフォートpush に倒す | M1/M2 で実地検証。最悪 D1正本だけで運用継続できる設計済み(§3.3) |
| 2 | **GH の refresh_token 同時要求の冪等性**(Fitbitは2分窓で同応答) | 同時refreshでトークン破壊リスク。cron主体 refresh + リクエスト側はロック/単一refresh化が要るか | cron単一主体に寄せて同時要求を避ける設計で回避 |
| 3 | **intraday のクライアント側ダウンサンプル仕様**(GHは detailLevel無・~5秒ネイティブ) | HRV/心拍の表示・容量。`dataPoints.list` + RFC3339秒精度フィルタ + 自前バケット | mappers.ts に集約。UI要件次第で粒度決定 |
| 4 | **UIフレームワーク選定**(Next.js on Workers vs Hono+軽量フロント vs Remix) | ビルド/PWA/SSRの作りに影響。本文書はフロント技術を未確定にしている(別タスク領域) | 本設計は「`apps/web` が `packages/core` を呼ぶ薄いアダプタ」である制約のみ課す |
| 5 | **皮膚温の単位差**(GHは日次+絶対℃、Fitbitは相対) | 表示の連続性。移行時に過去Fitbitデータと不連続 | provider mapper で吸収。過去データは「相対」ラベルで分離表示 |
| 6 | **GH の breaking change 頻度**(5/26にも変更) | provider実装が壊れうる | HealthProvider抽象 + DTO層分離で被害局所化。契約テストを vitest で維持 |
| 7 | **既存Fitbit過去データの移行可否**(GHへ遡及importできるか) | 過去ログの一元化 | 不可なら read時に Fitbit(9月まで)とGHを束ねて表示、以降はGHのみ。D1にアーカイブ取り込みも検討 |

---

## 8. まとめ(3行)

- **HealthProvider 抽象を捨てずコア化**し、Fitbit→GH の差し替え1点に絞る。これが9月期限とGHのbreaking changeへの唯一の保険。
- **`packages/core` を UI・MCP・Cron の3面が共有**し、書き込みは必ずドメインサービス→**D1正本→GH push**の一本道に。食事/ワークアウトの source of truth は D1(GHはミラー)、体重/睡眠は GH(D1は表示キャッシュ)。
- **MCP は写真食事ログと自然言語入力のために残す**が Read/Delete を絞りD1経由化。UI が登録/編集/削除/ヒートマップ可視化の主役。デプロイは認証境界の違いから **web Worker(cron相乗り)+ MCP Worker の2本**。

Sources:
- [Fitbit Web API 次フェーズ告知 (Fitbit Community)](https://community.fitbit.com/t5/Web-API-Development/Introducing-the-next-phase-of-the-Fitbit-Web-API/td-p/5821061)
- [Fitbit API deprecation (Thryve)](https://www.thryve.health/blog/fitbit-api-deprecation)
- [Google Health API Scopes](https://developers.google.com/health/scopes)
- [Google Health API Endpoints](https://developers.google.com/health/endpoints)
- [Google Health API dataPoints.list reference](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list)
- [Google Health API 解説 (tryterra)](https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api)

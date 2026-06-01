# 設計書: google-health-sidecar(単一ユーザー向けボディメイク sidecar アプリ)— 最終版

作成日: 2026-05-31 / 改訂: v3(批判レビュー §17.1 + コンシューマレビュー §17.2 + 実装前4面監査 §17.3 反映) / オーナー: tachibanayu24@gmail.com(ユーザーは本人1名のみ)
対象リポジトリ: `/Users/yuto/Workspace/tachibanayu24/google-health-sidecar`(現状ほぼ空・git未init)
読者前提: 本コードベースを読めない「普段使いの Claude アプリ」が単独でレビューできるよう、各判断に **根拠・代替案・トレードオフ・確度ラベル**(【確定】=一次情報で明記 / 【要検証】=情報源間で矛盾 or 未記載 / 【判断】=設計上の推論)を付す。
確度ラベルの時点性: API系の「確定」は特記なき限り **2026-05-31 時点のリファレンス基準**。GH API は actively evolving のため恒久保証ではない。

---

## 0. エグゼクティブサマリ

ジムでのボディメイクを本気でやるための、**完全に自分専用**の Google Health sidecar を新規構築する。中核となる設計判断は以下10点。

1. **新規構築は Google Health API v4(GH)直行**【判断】。Fitbit Web API は 2026-09 に完全停止【確定】するため、いま Fitbit に作るのは数か月後に確定で作り直す負債。ただし API は GA前で "actively evolving"(直近5/26にも破壊的変更)なので、`HealthProvider` 抽象を維持し差し替え可能に保つ。
2. **source of truth の二層化**。食事とワークアウトは**このアプリ(D1)が authoring 元かつ真実**。体重・睡眠など**センシングデータは GH が真実**で、daily batch で D1 にミラーする。
3. **筋トレ詳細(セット×レップ×重量×RPE)を保持するフィールドが GH v4 `exercise` には存在しない**【確定: 2026-05-31時点のリファレンスに該当フィールド無し、grep 0件】。よって筋トレ詳細は D1 に置き、GH へは「STRENGTH_TRAINING・所要時間・推定kcal・notesにサマリ文字列」だけ best-effort で push する二層構造が唯一妥当。将来 segment/strength 系フィールドが追加された場合に GH 直接保持へ移行できるよう、D1スキーマと Provider マッパは疎結合に保つ。
4. **食事の PFC を GH `nutrition-log` の `nutrients[]` でネイティブ保持できるかは【要検証・最重要】**。release notes(5/26時点)は nutrition write 解禁を明記しておらず(Hydration Log は read-only として登場)、data-types ページの writable 表記と矛盾する。よって GH への食事 push は **feature flag 化**し、M0初日に OAuth Playground で実 grant を確認するまで【確定】扱いにしない。D1 を正本に置くので、最悪 GH 食事 push が不能でもアプリの記録は失われない。
5. **配信は Cloudflare スタック**。UI(PWA)Worker(cron 相乗り)+ MCP Worker の **2デプロイ**、共有コアは `packages/core`。ストレージは D1(本体)+ KV(トークン・readキャッシュ)。R2 は MVP では不使用(進捗写真用に将来採用)。
6. **認証は二系統分離**。UIゲート = Google OIDC ログイン + 許可メール/sub allowlist。GH API アクセス = サーバーサイド OAuth(Pattern B)で refresh token を KV に長命保管。**OAuth同意画面を "In production" に publish 必須**(Testing だと refresh token が7日失効し無人Workerが死ぬ)【確定】。単一ユーザーなので CASA verification 不要(100ユーザー閾値)【確定】。
7. **重さは「入力された生値+単位」を正本として保存**。kg/lb の往復換算ドリフトを避けるため、保存は `entry_value`+`entry_unit`、`weight_kg` は派生キャッシュ。表示は両単位併記(要件8)。ジムのプレートが kg か lb かを **MVP着手前にオーナーへ確認**して主単位を確定する。
8. **UIは PWA + モバイル最適化**。React 19 + Vite + Cloudflare Vite Plugin、人体ヒートマップは `body-highlighter`(MIT, framework-agnostic)、種目マスタは `free-exercise-db`(Public Domain, 800+種目)。オフライン下書き(IndexedDB アウトボックス)はジムの電波事情から必須級。
9. **D1 の交差を踏まえた原子性設計**。D1 はインタラクティブトランザクション非対応で原子性は単一 `db.batch()` のみ。多表書込み(session→exercises→sets)・編集(食事=delete+recreate)は必ず1 batch に収める。外部I/O(GH push)は batch に入れず `gh_sync_state=pending` で別経路 best-effort。
10. **MCP保護のIP allowlist は「公式ページを唯一の真実とし、ハードコードせず一次防御は secret」**。Anthropic公式(platform.claude.com/docs/en/api/ip-addresses, 確認日2026-05-31)では outbound = `160.79.104.0/21`、inbound = `160.79.104.0/23` + IPv6 `2607:6bc0::/48`、`34.162.x.x/32` 群は廃止済。MCPへ届くのは Anthropic の **outbound** トラフィックなので filter 対象は outbound レンジ。値は変動前提で設定外出し+定期確認、IP全断を避けるため一次防御は `MCP_SHARED_SECRET`(§6.3, §11)。

---

## 1. 背景と目的・非目標

### 1.1 背景
- オーナーは Fitbit/Google Health のセンシングデータ(体重・睡眠・HRV等)を持っているが、ジムでの筋トレ記録・食事記録を「優れたUIで」「自分専用に」管理したい。
- 既存の `fitbit-googlehealth-mcp`(別repo, Cloudflare Workers + Hono + MCP, KVベース, D1未使用)が稼働中。これを廃止し本repoに移行する前提。
- Fitbit Web API は 2026-09 に完全停止、後継は Google Health API v4。今は dual-run window(両方動く猶予期間)。

### 1.2 目的(要件)
1. D1 など Cloudflare スタックで公開
2. Google auth で認証
3. ユーザーは本人のみ、完全に自分用
4. 登録/削除/編集を優れたUIで
5. UIは PWA でスマホ最適化
6. 既存MCP互換は重視しないが、GH API最新制約は重要
7. 各種目がどの部位に効くかのプリセット、人体ヒートマップ表示
8. 重さは lb と kg 両方表示

### 1.3 非目標(明示的にやらないこと)
- **マルチテナント / 行レベル権限 / 監査ログの本格運用**【判断】: ユーザー1名なので D1 に `user_id` を持たせない。将来拡張時の負債は受容。
- **プッシュ通知(Web Push)**【判断】: iOS Web Push は home-screen追加+standalone必須で運用が脆く、単一ユーザーに見合わない。休憩タイマーはローカル通知(vibrate + Web Audio)で代替。MVPスコープ外。
- **食事写真の永続保存(R2)**【判断】: 解析後に残すべきは構造化PFCで画像は栄養計算に不要。カラム(`photo_r2_key`)だけ予約し実体保存は後付け。
- **intraday(秒精度心拍)の常時描画**: daily batch では日次集計値のみミラー。intraday は MCP の on-demand read に回す。
- **GH側で編集された筋トレ/食事の取り込み**: 本アプリが唯一の編集UI。GH→D1の逆流は体重/睡眠等センシング系のみ。
- **identified food / Food カタログ検索への依存**【判断, 新規明示】: GH 食事 push は anonymous food(`food_display_name`+`nutrients[]`)固定。Food ID 解決・栄養DB検索は調査未了のため非目標(将来#)。
- **周径・進捗写真は MVP外だが将来拡張として明示**(§1.4)。完全な切り捨てではなく M2+ で導入。

### 1.4 将来拡張(非目標だが設計上の居場所を確保)
ボディメイク本気勢にとって周径と進捗写真は体重と同等の進捗指標。GHに器が無いため落とすのではなく、**authoring=app の典型データとして D1 に置く前提**で席を予約する(§7に `body_measurements` を将来テーブルとして記載、進捗写真は `photo_r2_key` の用途拡張)。ロードマップ M2+(§13)。周径は §8.6 統合相関ビューの軸としても価値が高い。

---

## 2. source of truth と全体方針

これが本設計の背骨。データ種別ごとに「誰が書く(authoring)」「どこが真実(source of truth)」「同期方向」を固定する。

| データ種別 | authoring(書き手) | source of truth | 同期方向 | 頻度 |
|---|---|---|---|---|
| ワークアウト詳細(set/rep/weight/RPE) | 本アプリ(UI/MCP) | **D1** | D1のみ(GHには詳細を投影しない) | — |
| ワークアウト**サマリ**(STRENGTH_TRAINING 1件) | 本アプリ | **D1** | D1 → GH push(best-effort) | セッション完了/編集/削除時 |
| 食事(PFC含む) | 本アプリ(UI/MCP) | **D1** | D1 → GH push(**flag付き best-effort**, §5.2) | 登録/編集/削除時 |
| 周径・進捗写真(将来) | 本アプリ | **D1** | D1のみ(GHに器なし) | 手入力時 |
| 体重・体脂肪 | デバイス測定=GH / 手入力=本アプリ | **二系統明確化(§2.1)** | 測定はGH→D1 pull(read-only)、手入力はD1正本→GH writeonly push | daily batch + 手入力時 |
| 睡眠・HRV・SpO2・安静時心拍・皮膚温・呼吸数・VO2max・歩数 | デバイス(GH) | **GH** | GH → D1 pull(読み取り専用) | daily batch(§5.4マスタ表が読取対象の正) |
| トレ中 intraday 心拍 | GH | **GH** | GH → D1 pull(任意・セッション時間窓) | オンデマンド |

### 2.1 体重の扱いを単一方針に確定(レビュー指摘: 3箇所矛盾の解消)
旧ドラフトは Today=read-only バッジ、§9.7=「GHに書き戻す」、§14=「閲覧のみが安全」と食い違っていた。**以下に一本化する**:
- **デバイス測定値**(スマートスケール等)= GH が真実。daily batch で D1 にミラー(`source='google_health'`, `gh_external_id` あり)。UI上 **read-only**(出所バッジ表示)。
- **手入力値**(器具なしで体重を記録したい時)= D1 が正本(`source='app'`, `gh_external_id` なし)。GH へは `health_metrics_and_measurements.writeonly` で best-effort push し、`recordingMethod="MANUAL"` を付ける。
- **dedupe**: 同日に GH ミラーと手入力が並ぶ場合、**デバイス測定(GHミラー)を優先表示**し手入力は補助。`measured_at` の近接(同日)を重複判定キーにする。
- §9.2 Today はデバイス測定があればそれを read-only 表示、無ければ手入力を編集可能表示。§9.7 の体重編集UIは「手入力値のみ編集可、デバイス測定は GH 側が真実」と明示。

**なぜワークアウト/食事の真実を D1 に置くか**【判断】:
- GH v4 `exercise` には set/rep/weight の器が物理的に無い(§5.3, §8で詳述)。筋トレの真実を置く場所が GH には存在しない。
- GH の nutrition/exercise write は GA前で不安定、特に **nutrition write は実 grant 未確認**(§5.2)。正本を D1 に置けば、GHが落ちても・breaking changeが来ても・9月にFitbitが死んでも、記録は失われない。GHは Google Health エコシステム(Gemini Health Coach・体重との統合表示)へ流すためのミラー。
- **競合解決は常に D1-wins**。GHは投影先なので双方向マージの複雑性を排除。トレードオフ: Geminiコーチ上で筋トレログを編集しても本アプリには反映されない(許容、要件3と整合)。

---

## 3. アーキテクチャ全体図

```
┌──────────────┐   Google OIDC      ┌──────────────────────────── apps/web (UI Worker) ──────────────────────────┐
│  Browser/PWA │──ログインゲート────▶│  ASSETS binding (React PWA配信)                                            │
│  (スマホ)     │   Cookie session   │  Hono:                                                                      │
└──────────────┘                    │   ├─ /auth/*  Google OIDC ゲート(allowlist: email + sub)                  │
                                     │   ├─ /api/*   UIバックエンド ─────┐                                        │
┌──────────────┐  secret(一次防御)   │   ├─ scheduled() daily pull ──────┤                                        │
│  Claude.ai   │  + outbound IP      │   └─ scheduled() gh-push retry ───┤(別cronスロットに分離, §12.2)          │
│  (MCP client)│  (二次防御,設定外出し)└──────────────────────────────────┼────────────────────────────────────────┘
└──────┬───────┘                                                        │  import
       │ outbound 160.79.104.0/21   ┌──────────── apps/mcp (MCP Worker) ┼───────────┐
       └───────────────────────────▶│  @hono/mcp Streamable HTTP(stateless)         │
                                     │  guard: secret(必須) + outbound IP allowlist  │
                                     │         (v4 /21 + 将来v6, 公式ページ追従)      │
                                     │  tools/ (write→Service, read最小, photo)  ────┤
                                     └────────────────────────────────────────────────┘
                                                          │
                                  ┌───────────────────────▼───────────────────────┐
                                  │       packages/core (両Workerが共有)            │
                                  │  services/  WorkoutService / NutritionService / │
                                  │             BodyService / SyncService           │  ← 全write はここを1点経由
                                  │  providers/ HealthProvider(抽象)               │
                                  │             ├ GoogleHealthProvider(既定)        │
                                  │             └ FitbitProvider(暫定/9月で削除)    │
                                  │  db/        repositories + migrations (batch原子性) │
                                  │  auth/      tokenStore(KV,共通refresh) + googleOAuth│
                                  └───────┬───────────────────────────┬─────────────┘
                                          │                           │
                              ┌───────────▼──────────┐    ┌───────────▼───────────────┐
                              │  D1 (本体・真実)       │    │  KV  TOKENS(GH OAuth)     │
                              │  primaryのみ(読みレプ  │    │      CACHE(read TTL1h)    │
                              │  リカ無効, §12.5)      │    │      LOCK(refresh排他)    │
                              │  workout/meal/master  │    └───────────────────────────┘
                              │  body/sleep/daily/sync│                │
                              └──────────────────────┘                │ refresh 60s前自動(両Worker共通)
                                          ▲                           ▼
                                          │ daily pull (cron 日3回)    ┌──────────────────────────────────────┐
                                          └────────────────────────────│  Google Health API v4                  │
                                                                       │  health.googleapis.com/v4              │
                                                                       │  dataPoints :list/:reconcile/create/   │
                                                                       │  patch/batchDelete                     │
                                                                       └────────────────────────────────────────┘
```

**2 Worker に分ける根拠**【判断】: ① MCPの IP allowlist + secret 認証を、公開UIの Google ログインと混ぜない(認証モデルが別)。② MCPの breaking change デプロイで UI を巻き込まない。③ 同一Workerだと「MCP用IPを通したいがUIは公開」という矛盾するルーティングを抱え、allowlist 適用ミス1つでMCPが露出する。物理分離が単一ユーザーでも安全側。
- 代替案: 全部1 Worker 同居 → 却下(上記③)。3 Worker完全分離(cron専用) → 却下(日次バッチは負荷極小で運用オーバーヘッドに見合わない、`apps/web` の `scheduled` 相乗りで十分)。

---

## 4. 技術スタックと選定理由

### 4.1 全体スタック
| レイヤ | 採用 | 根拠 |
|---|---|---|
| 実行基盤 | Cloudflare Workers | 要件1。既存MCPと同じ。 |
| Web framework | Hono | 既存資産流用。UI API・MCP・cron を同一言語/型で共有。 |
| フロント | React 19 + Vite + `@cloudflare/vite-plugin`(v1 GA) | Workers公式の第一級SPA構成。リッチなインタラクション(休憩タイマー/SVGヒートマップ/楽観更新)に最適。 |
| ルーティング/状態 | TanStack Router + TanStack Query | サーバ状態のオフライン/楽観更新/キャッシュに最適。 |
| UI | Tailwind + shadcn/ui | モバイル最適、ダーク前提でジム映え。 |
| MCP | `@hono/mcp` + MCP SDK, Streamable HTTP(stateless) | モバイル/Claude.ai利用に stateless 必須。既存資産流用。 |
| チャート | Recharts | データ点が少ない個人用途で実装速度最優先。visx/Chart.jsは過剰。 |
| PWA | vite-plugin-pwa(generateSW + Workbox)+ IndexedDB アウトボックス | アプリシェルprecache + 書き込みオフライン下書き。 |
| ツールチェーン | pnpm workspace / biome / vitest / wrangler | 既存資産流用。モノレポ化。 |

### 4.2 Cloudflare ストレージの役割分担

| リソース | 採否 | 用途 | 根拠 |
|---|---|---|---|
| **D1** | ★採用(本体) | ワークアウト/食事/種目マスタ/部位/プリセット/設定/目標/body_metricsミラー/sync_state | リレーショナルで集計・期間検索・JOIN(種目→部位ヒートマップ)が必要。既存MCPがKVにpresetを押し込んだのはFitbit制約であり、本アプリは正攻法でD1。**原子性は単一 `db.batch()` のみ**(§8.5)。 |
| **KV** | ★採用 | ① GH OAuth token(TOKENS)② GH read結果キャッシュ TTL1h(CACHE)③ refresh排他ロック(LOCK) | 単一キーの低レイテンシ read/write + TTL に最適。リレーショナルでない。 |
| **R2** | MVP不採用 | (将来)進捗写真・食事写真 | 解析後は構造化PFCのみ必要。`meals.photo_r2_key` / 進捗写真カラムだけ予約。 |
| **Durable Objects** | 不採用 | — | 単一ユーザーで強整合並行調停の価値が無い。 |
| **Queues** | MVPは条件付き不採用(§12.2で再評価) | daily batch ファンアウト | cron同期で予算内なら不要。サブリクエスト/wall-clock予算超過リスクが見えたら dataType単位ジョブ分割に採用。 |
| **Cron Triggers** | ★採用 | GH→D1 daily pull + GH push リトライ(別スロット) | §5.4, §12.2。token refresh 専用 cron は持たず、各 cron/リクエスト実行時に `getAccessToken` 内で失効60s前 lazy refresh(§6.2)。 |

**KV書き込み制約の注意**【要検証: 数値は変動しうる, 確認日2026-05-31, 出典 kv/platform/pricing】: KV無料枠の書き込み上限はプラン/時点で変わりうるが、執筆時点で約1,000回/日想定。素朴に「毎リクエストでtoken write」「全read結果をcache write」すると枯渇しうる。対策: tokenは失効60s前のみrefresh→write(1日数回)+ Workerメモリの二層キャッシュ。readキャッシュは高頻度同一クエリ限定。token/cache の KV 書込みは概算で1日数十回。**無料枠は監視対象**とし、超過時は Workers KV 有料枠 or キャッシュを D1 へ移設で対応(§12.4)。

---

## 5. Google Health API v4 連携

base: `https://health.googleapis.com/v4` / package: `google.devicesandservices.health.v4`。GA表記なし、"actively evolving"。

### 5.1 共通エンドポイント形状【確定】
全データ型が `users.dataTypes.dataPoints` に集約。`userId` は `me`。

| 操作 | HTTP | パス |
|---|---|---|
| create | POST | `/v4/users/me/dataTypes/{dataType}/dataPoints` |
| list | GET | `.../dataPoints` |
| patch | PATCH | `.../dataPoints/{id}` |
| batchDelete | POST | `.../dataPoints:batchDelete` |
| reconcile | **【要検証: M0で discovery doc から確定】** REST=POST/endpointsページ=GETで表記矛盾 | `.../dataPoints:reconcile` |
| rollUp / dailyRollUp | POST | `.../dataPoints:rollUp` / `:dailyRollUp` |

**reconcile verb の確定方針**(レビュー指摘): daily batch の中核呼び出しなので「両方試す」では実装が固まらない。**M0で discovery doc(`health.googleapis.com` の `$discovery/rest`)を唯一の真実として verb を確定**し、本文の暫定表記を実値へ更新。discovery doc を CI で取得/pin し、reconcile を含む全エンドポイントの method を契約テストで固定(§14リスク#7 breaking change検知と統合)。

DataPoint 共通: `name` / `dataSource`{`recordingMethod`, `device`, ...} / data(union)。**手入力は `recordingMethod="MANUAL"` を付ける**【確定】。

create例(body-fat、公式verbatim):
```json
POST /v4/users/me/dataTypes/body-fat/dataPoints
{ "name":"bodyFatName",
  "dataSource":{"recordingMethod":"ACTIVELY_MEASURED",
    "device":{"formFactor":"SCALE","manufacturer":"Scales R Us","displayName":"HumanScale"}},
  "bodyFat":{"sampleTime":{"physicalTime":"2026-03-10T10:00:00Z"},"percentage":20}}
```

### 5.2 書き込み: 食事(nutrition-log)【要検証・最重要(確度を【確定】から格下げ)】

**内部矛盾の解消(レビュー critical/major)**: 旧ドラフトは §0/§5.2で「nutrition writable / PFCネイティブ保持【確定】」と断定する一方、§14で「【要検証・矛盾】」としていた。一次情報を精査すると:
- data-types ページは `nutrition-log` が create/update/batchDelete を持つことを示す。
- **しかし release notes(2026-05-26時点)は write 解禁を exercise/body-fat/weight/profile/settings/sleep(3/24〜)に限定列挙し、nutrition/hydration の write 解禁を一切記載していない**。Hydration Log は read-only としてのみ登場。
- 前提資料の「hydration/nutrition は5/26から書き込み可」は **一次情報で裏取りできない**。第三者クライアントへの実 grant は未確認。

→ **結論: nutrition write は【要検証・最重要】に統一**。これは食事機能(本アプリの主要価値)の GH 連携が成立しない可能性を意味する根幹リスク。設計対応:
- **M0最優先ゲート**: OAuth Playground で `googlehealth.nutrition.writeonly` を取得 → `nutrition-log` create を1発撃ち、200/403 を確認(§14リスク#1)。
- **GH 食事 push を feature flag 化**(`FEATURE_GH_NUTRITION_PUSH`)。flag OFF 既定で出荷可能にし、200確認後に ON。
- **403時のフォールバックを本文化**: D1 が正本なので食事記録は失われない。GH ミラーは (a) 当面 GH push を停止し M3 で再評価、または (b) 代替 dataType(hydration-log 等)へ部分push を検討。release notes に nutrition write 解禁が出るまで本機能は optional。

**nutrition-log の形状(grant されている前提での設計)**【確定: フィールド定義 / 要検証: 実write可否】:
- dataType ID: `nutrition-log`。スコープ `…/googlehealth.nutrition.writeonly`。
- **2つの作り方**:
  - Identified food: `food`(Food ID)参照 → nutrients/energy 自動補完、編集可能。**ただし Food ID 解決エンドポイント/カタログ供給源が調査未了**(§14#2)→ 本アプリは依存しない。
  - **Anonymous food**: `food_display_name` + `nutrients` 手動セット。**"anonymous food から作った nutrition log は editable でない"(patch不可)**【確定】。
- **採用方針: anonymous food 固定**(`food_display_name`+`nutrients[]`)。理由: Food カタログ未調査の identified に依存すると写真解析 items[]→push 経路が詰む。トレードオフ: anonymous は immutable なので **編集は常に batchDelete+create**(patch最適化は食事には不適用, §8.5で運動と分岐)。
- フィールド: `interval`(必須) / `nutrients[]`(`NutrientQuantity`={`quantity`:WeightQuantity, `nutrient`:Nutrient enum}) / `energy`(EnergyQuantity) / `total_carbohydrate` / `total_fat` / `meal_type` / `serving` / `food_display_name`。
- `Nutrient` enum: PROTEIN, CARBOHYDRATES, TOTAL_FAT, SATURATED_FAT, DIETARY_FIBER, SODIUM, SUGAR, CHOLESTEROL, ビタミン/ミネラル各種【確定】。
- `EnergyQuantity`=`kcal`(double,必須)+`user_provided_unit`(任意)。`WeightQuantity`=`grams`(double,必須)+`user_provided_unit`(任意, GRAM/KILOGRAM/OUNCE/POUND)。
- `MealType` 写像: **アプリ内6種(Breakfast/MorningSnack/Lunch/AfternoonSnack/Dinner/Anytime)→ GH実使用4値(BREAKFAST/LUNCH/DINNER/SNACK)へ縮退**(MorningSnack/AfternoonSnack/Anytime→SNACK)。GH enum 自体は UNSPECIFIED 含む5値だが UNSPECIFIED は未使用。アプリ内は6種を保持(§7)。

### 5.3 書き込み: 運動(exercise)【確定: 2026-05-31時点】
- dataType ID: `exercise`(writable, 3/24から)。スコープ `…/googlehealth.activity_and_fitness.writeonly`。
- フィールド: `interval`(必須) / `exerciseType`(enum, `STRENGTH_TRAINING`/`WEIGHTLIFTING`/`WORKOUT`等) / `metricsSummary`(calories/distance/steps/avg HR等) / `splits[]`(distance/time/calorie区切りのみ) / `exerciseEvents[]`(START/STOP/PAUSE/RESUME のみ) / `exerciseMetadata`{`displayName`(必須), `activeDuration`, `notes`}。
- **筋トレ詳細(sets/reps/weight/load/RPE/set-type)を保持するフィールドは 2026-05-31時点のリファレンスに存在しない**【確定: grep 0件、基盤の Health Connect でも `ExerciseSegment` は repetitions を持つが weight は無く、GH v4 REST には segments 相当すら露出していない】。
- **確度の限定(レビュー指摘)**: API は actively evolving のため「恒久的に存在しない」とは言い切れない。将来 segment/strength 系フィールドが追加されたら GH 直接保持に移行できるよう、**D1スキーマと GoogleHealthProvider のマッパを疎結合に保つ**。

→ **二層構造が唯一妥当**。Layer1(D1)=筋トレ詳細の真実。Layer2(GH)=サマリ投影。GHには `exerciseType=STRENGTH_TRAINING`・`displayName`・`activeDuration`・推定`calories`・`notes`にサマリ文字列(例 `"Bench 60kg×8×3; Squat 80kg×5×5"`)+逆引きタグ(§8.5)を書く。

### 5.4 読み込み: daily batch(体重・睡眠・センシング)

**読む対象の単一マスタ表(監査指摘: §12.2ループ・§7 daily_metrics・§2 SoT表はすべてこの表をマスタとして整合させる)**。`内部キー`= `sync_runs.data_type` の値かつ §12.2 ループの反復単位(=**GH dataType ID 粒度**)。
| 内部キー(sync_runs/loop) | GH dataType ID | readonly scope | 格納先(table.column / metric) | 確度 |
|---|---|---|---|---|
| `weight` | `weight` | health_metrics_and_measurements | `body_metrics.weight_kg` | 【確定】 |
| `body-fat` | `body-fat` | health_metrics_and_measurements | `body_metrics.body_fat_pct` | 【確定】 |
| `sleep` | `sleep` | sleep | `sleep_logs.*` | 【確定】 |
| `resting-hr` | `daily-resting-heart-rate` | activity_and_fitness | `daily_metrics(metric='resting_hr', unit='bpm')` | 【確定】 |
| `hrv` | `daily-heart-rate-variability` | activity_and_fitness | `daily_metrics(metric='hrv_rmssd', unit='ms')` | 【確定】 |
| `spo2` | `daily-oxygen-saturation` | health_metrics_and_measurements | `daily_metrics(metric='spo2_avg', unit='%')` | 【確定】 |
| `vo2max` | `daily-vo2-max` | activity_and_fitness | `daily_metrics(metric='vo2max', unit='ml/kg/min')` | 【確定】 |
| `resp-rate` | `daily-respiratory-rate` | health_metrics_and_measurements | `daily_metrics(metric='resp_rate', unit='/min')` | ✅【確定: 2026-06-01 実データ取得 `breathsPerMinute`, §17.5】 |
| `skin-temp` | (なし) | health_metrics_and_measurements | `daily_metrics(metric='skin_temp_c', unit='celsius', 絶対℃)` | 【恒久除外: 候補8種すべて Invalid data type ID と実機確定(2026-06-01)→ GH 未提供, §17.5】 |
| `steps` | `steps` | activity_and_fitness | `daily_metrics(metric='steps', unit='count')` | 【確定・MVP任意】 |

- **体重/体脂肪の合流**: `weight` と `body-fat` は別 dataType・別 sync_runs 行として個別に pull し、**日付キーで `body_metrics` の同一行へ合流(upsert)**する。`vo2max` は `daily-vo2-max` を主とし、`run-vo2-max` が必要なら別内部キーで追加(MVPは `daily-vo2-max` のみ)。
- **steps はMVP任意**(ボディメイク主目的では従。enum/loopには載せるが §13 で後回し可)。`resp-rate`/`skin-temp` は dataType ID をM0 discovery docで確定してから loop 有効化(未確定なら一時 skip、表・enum・loop・SoTの4箇所は本表に揃える)。
- **エコーループ防止(監査 blocker)**: `weight`/`body-fat` は手入力 push(`recordingMethod=MANUAL`, source='app')が reconcile で戻ってくる。pull 時に **自分の書込み(gh_sync_state に記録した `gh_datapoint_id`/`gh_data_origin` に一致 or `recordingMethod=MANUAL` かつ自前 dataSource)を own-write と判定し、既存 source='app' 行へ `gh_external_id` を紐付けるだけで source は上書きしない**(§12.2に実装、§2.1 dedupeが手入力をデバイス測定と誤認するのを防ぐ)。

読む対象 dataType ID(参考・旧表記): 上のマスタ表が唯一の正。

- **list** = 生データ(device/manual, source付き、複数デバイス重複は自己dedupe要)。**reconcile** = Google突合済の単一ストリーム。**daily batchの「最終的な1日の値」は reconcile が楽**【確定】。
- `list` filter は AIP-160構文。時間範囲は形状依存(interval系=`interval.start_time`、sample系=`sample_time.physical_time`、daily系=`date`)。RFC-3339 or civil。**interval start 降順、`pageToken` でページング。exercise/sleep は pageSize 上限25**【確定】。
- **intraday注意**【確定】: Fitbitの detailLevel(1sec/5min)が無く、ネイティブ~5秒サンプルを `dataPoints.list` + RFC3339秒精度filter で取りクライアント側ダウンサンプルが必要。**daily batchでは intraday を引かず日次集計値だけミラー**。
- 皮膚温は**日次・絶対℃**(Fitbitの相対値と非互換)→ `daily_metrics.unit='celsius'` で保存、過去Fitbitデータは「相対」ラベルで分離。
- **レート制限の数値は公式未掲載**【要検証】→ daily batch は直列+指数バックオフ(429想定)、実機で観測後に並列度調整。cron予算見積りは §12.2。

### 5.5 Fitbit Web API との関係と9月期限【確定】
- Fitbit Web API(api.fitbit.com)は **2026-09 完全停止**。5/31時点はまだ稼働(dual-run)。後継は GH API v4。
- Fitbitの access/refresh token は GH へ移行不可 → 一度だけ Google OAuth を踏み直す。
- アカウント統合は5/19完了、未統合は7/15データ削除(オーナーのアカウントが統合済みか確認必要、§14#9)。
- 過去Fitbitデータの GH 遡及importは可否不明【要検証】→ 不可なら read時にFitbit(9月まで)とGHを束ねて表示、以降GHのみ。

### 5.6 Fitbit直行 vs GH直行の判断【判断】
| 観点 | Fitbit Web API | GH API v4 |
|---|---|---|
| 寿命 | 2026-09停止(残り約3か月) | 後継・継続 |
| 書き込みのクリーンさ | 食事PFC silent drop → KV preset必須 | nutrients[]でネイティブ保持(ただし write実grant要検証) |
| 安定性 | 枯れているがEOL | GA前、5/26にも破壊的変更 |

**結論: GH API v4 直行。** Fitbitに作ると3か月後に確定で作り直し(token移行不可)。残る懸念(GA前・breaking change・nutrition write未確認)は **Provider抽象 + DTO層分離 + 薄いZodスキーマ + 契約テスト + feature flag** で吸収。`FitbitProvider`(既存)は read検証用・移行直後フォールバックとして M3 まで残置、9月前に削除。

---

## 6. 認証・認可

UIログインのゲートと GH API アクセスは目的が違うので**二系統に分離**【判断】。

| 系統 | 目的 | フロー | 検証/保管 |
|---|---|---|---|
| **A. UIゲート** | 自分だけブラウザ/PWAに入れる | Sign in with Google(OIDC, `openid email`) | ID token を Google JWKS で署名検証 → `iss`/`aud`/`exp` + `email`/`sub` が許可値か確認 → 自前署名JWT(HS256, 7-30日)を HttpOnly/Secure/SameSite=Lax Cookie に格納 |
| **B. GH APIアクセス** | センシングread / 食事・運動write | サーバーサイドOAuth(`googlehealth.*` scope群, `access_type=offline`) | refresh_token を KV(TOKENS)に長命保管。失効60s前に自動refresh(Pattern B踏襲) |

### 6.1 系統A(UIゲート)
- 許可ユーザー固定: `ALLOWED_EMAIL`(=tachibanayu24@gmail.com)+ 安定不変の `ALLOWED_SUB`(Google subject)を併用(emailは理論上変わりうるので sub 併用が堅牢、要件3を厳格化)。`email_verified===true` も確認。
- Google ID token 自体はセッションに使い回さない(短命)。自前JWTを発行。`jose` で検証(`nodejs_compat`)。JWKSは KV/メモリに短期キャッシュ。

**Cloudflare Access を使わない理由**【判断】: Accessは人間ブラウザ前提。同一構成に `/mcp`(machine-to-machine)や cron(無人)が同居するため、全体被せ型SSOはマシン系経路と相性が悪い。Hono middleware でパス単位に出し分ける自前OIDCを採用。フォールバック案として「`/` と `/api/*` だけ Access、`/mcp` は対象外パス」も成立(初速重視時の選択肢、§14#15)。

### 6.2 系統B(GH OAuth, Pattern B)【確定】
- セットアップ: GCPプロジェクト → Google Health API有効化 → OAuthクライアント(Web Server型) → **同意画面を "In production" に publish(必須)** → Data Accessページでスコープ明示選択。
- **refresh token長命化**: Testingだと7日失効(無人Worker即死)。Productionなら無期限(revoke/6か月未使用/上限超で失効)。daily batchで毎日refreshを回すので6か月未使用には絶対当たらない。
- **CASA不要**: 100ユーザー以下なら unverified-production のまま運用可。本アプリは1人 → CASA不要、長命トークン可。
- **`include_granted_scopes=true` を使わない**【確定・重要】: legacy `fitness.*` scope が union されると GH data plane が mixed-scope token を reject する。
- **refresh rotation 挙動の正しい理解(レビュー指摘で修正)**【確定】: Googleは refresh 毎に refresh_token をローテーションせず、同一 refresh_token を継続使用でき(上限〜100アクティブ/クライアント-ユーザー)、同時refreshは互いに有効な access_token を得られるため**本質的に安全**。旧ドラフトの「Fitbitと異なる可能性」懸念は方向がずれていた。
- **真の要対策 = クロスWorkerの access_token 鮮度**(レビュー指摘): web(cron)と mcp Worker が同じ TOKENS(KV)を読むが、片方しか refresh しない設計だともう片方が失効間際の古い token を掴む stale ウィンドウが生じる。→ **両Workerとも `packages/core/auth` 共通の `getAccessToken()` を使い、失効60s前なら自前で refresh+KV書き戻し**。KV(LOCK)で二重refreshを抑止しつつ、**ロック取得失敗側は KV を再readして新tokenを拾う**(待ちでなく再読)。
- 初期token取得: CLIで1回だけ offline同意を踏み `wrangler kv key put` で KV投入(`tools/oauth-bootstrap.ts`)。

**最小スコープセット**【判断】:
- write: `activity_and_fitness.writeonly`(exercise) + `nutrition.writeonly`(食事, **flag付き**) + `health_metrics_and_measurements.writeonly`(体重/体脂肪手入力)
- read: `health_metrics_and_measurements.readonly`(体重/SpO2) + `sleep.readonly` + `activity_and_fitness.readonly`(歩数/心拍/HRV/VO2max)

### 6.3 MCP保護【確定・踏襲 + IP値修正】
**一次防御 = URL埋め込み `MCP_SHARED_SECRET`。二次防御 = Anthropic outbound IP allowlist。** Claude.aiにはOAuthなしCustom Connector登録。

**IP allowlist の正確化(レビュー critical への対応・出典で再確認)**【確定: 確認日2026-05-31, 出典 platform.claude.com/docs/en/api/ip-addresses】:
- MCPサーバーへ届くのは Anthropic の **outbound**(MCP tool call)トラフィック。よって filter 対象は **outbound レンジ**。
- 公式現行値: **outbound IPv4 = `160.79.104.0/21`**(これは現行で「使用中」。レビューが「廃止」とした指摘は **inbound/outbound の取り違え**で、実際に廃止されたのは `34.162.x.x/32` 群)。inbound は `160.79.104.0/23` + IPv6 `2607:6bc0::/48`。
- 公式ページに **outbound の IPv6 は現時点で明記が無い**。将来 outbound v6 が追加・公表される可能性に備え、Worker 側で `CF-Connecting-IP` の v4/v6 双方をパースできる実装にし、v6 レンジが公表されたら設定追加で対応。
- **運用方針(レビューの健全な指摘は採用)**: IPレンジは変動前提。**Anthropic公式ページを唯一の真実とし、値をハードコードせず secret/設定で外出し+定期確認**。IP変動時に MCP が全断するのを避けるため **一次防御は secret**、allowlist は補助。secret さえ正しければ IP allowlist を一時的に緩めても接続性を維持できる(fail-open は IP のみ、secret は fail-closed)。

---

## 7. データモデル(D1 DDL)

設計方針: 重さは**入力生値+単位を正本**(§7.0)。時刻はUTC unixepoch + JST基準の `date`(YYYY-MM-DD)を別持ちで日次集計のTZブレ回避。GH由来行は `gh_external_id` をユニークキーに冪等upsert。**多表書込み・編集は単一 `db.batch()` に収める**(§8.5)。

**マイグレーション/FK方針(監査指摘)**: SQLite/D1 は `CREATE TABLE` 時に親テーブルの存在を要求せず、**FK は DML 時にのみ強制**されるため、下記 DDL の前方参照(`workout_sessions.template_id`→`workout_templates`、`meal_items.preset_id`→`meal_presets`)は単一ファイルでも適用順非依存で安全。マイグレーションは連番ファイル(`0001_schema.sql` / `0002_seed.sql` …)で `wrangler d1 migrations apply` 適用、seed は冪等(`INSERT OR IGNORE`)で本体と分離。`PRAGMA foreign_keys=ON` を前提(§8.5 のロールバックは FK/制約違反時)。

### 7.0 重量正本のドリフト解消(レビュー major への対応)
旧ドラフトは「kg保存・lb表示換算」で、lbプレート環境だと 80kg→176.4lb→読み戻し80.01kg の往復ドリフトが出て前回値プレフィル(§9.3の核心UX)が毎回端数化する問題があった。**修正**: `workout_sets` は **`entry_value` + `entry_unit` を入力生値として正本扱い**(lb入力なら 185lb をそのまま保存・表示・プレフィル)、`weight_kg` は派生キャッシュ。**保存生値への往復書き戻しはしない**のでドリフトは出ない。
- **集計(ボリューム/e1RM/PR)は §8.1 `load_kg` で必ず kg へ正規化してから積算する**(監査指摘: §14#11 で1セッション内 kg/lb 混在を許容したため「同一単位系で算術」は不可能。kg正規化が唯一の正)。**§8.1 が集計の単一の正**。`body_metrics` も同方針(生値保存・集計はkg)。

```sql
-- ============ アプリ設定(単一行) ============
CREATE TABLE settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),   -- 常に1行
  unit_preference TEXT NOT NULL DEFAULT 'kg',           -- 'kg'|'lb' 主単位(要件8)
  e1rm_formula    TEXT NOT NULL DEFAULT 'epley',        -- 'epley'|'brzycki'(§8.2)
  locale          TEXT NOT NULL DEFAULT 'ja',
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ 栄養目標(フェーズ履歴) ============
CREATE TABLE nutrition_targets (
  id            TEXT PRIMARY KEY,
  date_from     TEXT NOT NULL,                          -- この日から有効('YYYY-MM-DD')
  phase         TEXT NOT NULL DEFAULT 'maintain',       -- 'bulk'|'cut'|'maintain'
  target_kcal   REAL NOT NULL,
  target_protein_g REAL NOT NULL,
  target_fat_g  REAL NOT NULL,
  target_carbs_g REAL NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_nutrition_targets_from ON nutrition_targets(date_from);
-- Today画面の '/2,200kcal' 分母は「date <= 今日 の最大 date_from」行から引く

-- ============ マスタ: 筋部位(シード固定, ヒートマップ単位) ============
CREATE TABLE muscle_groups (
  id            TEXT PRIMARY KEY,    -- 'chest','lats','traps','front_delts','side_delts','rear_delts',
                                     -- 'biceps','triceps','forearms','abs','obliques','quads',
                                     -- 'hamstrings','glutes','calves','lower_back'
  name_ja       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  region        TEXT NOT NULL,       -- 'upper_push'|'upper_pull'|'legs'|'core'(週間ボリューム roll-up用)
  body_side     TEXT NOT NULL,       -- 'front'|'back'(ヒートマップ前面/背面)
  svg_region_id TEXT NOT NULL,       -- 人体SVGのパスID対応
  weekly_target_sets INTEGER,        -- ★目標基準ヒートマップ(§8.3)の部位別週間目標セット数
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ マスタ: 種目(free-exercise-db seed) ============
CREATE TABLE exercises (
  id               TEXT PRIMARY KEY,           -- free-exercise-dbのid or ULID
  name_en          TEXT NOT NULL,
  name_ja          TEXT,                        -- 任意補完(LLMバッチ翻訳, 空なら英語fallback)
  category         TEXT NOT NULL,               -- 'compound'|'isolation'|'cardio'
  equipment        TEXT,                        -- 'barbell'|'dumbbell'|'machine'|'cable'|'bodyweight'|'smith'|'band'
  movement_pattern TEXT,                        -- 'horizontal_push'|'vertical_pull'|'hinge'|'squat'|'lunge'|...
  laterality       TEXT NOT NULL DEFAULT 'bilateral', -- 'unilateral'|'bilateral'
  load_basis       TEXT NOT NULL DEFAULT 'total',     -- ★入力値が表す荷重の意味(レビュー指摘の片側/合計規約):
                                                      --   'total'(バーベル等: 入力=動かす総重量)
                                                      --   'per_limb'(ダンベル: 入力=片手分→ボリューム×2、表示はダンベル表記のまま)
                                                      --   'per_side'(片側プレートマシン/ハンマー: 入力=片側→×2)
                                                      --   §7.0「入力生値は変換せず保存」を保ちつつ、ボリュームは load_basis 乗数で正規化
  is_bodyweight    INTEGER NOT NULL DEFAULT 0,
  bw_factor        REAL NOT NULL DEFAULT 1.0,         -- 自重ボリュームでの体重寄与率(懸垂≈1.0, ディップス≈1.0, 腕立て≈0.65 等)
  default_rep_range TEXT,                        -- プレフィルヒント '8-12'
  gh_exercise_type TEXT,                         -- GH pushの exerciseType(基本 'STRENGTH_TRAINING')
  images           TEXT NOT NULL DEFAULT '[]',   -- JSON配列(URL)
  instructions     TEXT NOT NULL DEFAULT '[]',   -- JSON配列(英語)
  is_custom        INTEGER NOT NULL DEFAULT 0,   -- ユーザー追加(要件4)
  is_favorite      INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ 種目↔部位 多対多 + 効き係数(ヒートマップ/ボリュームの心臓部) ============
-- ★レビュー指摘: PKを (exercise_id, muscle_group_id) に変更し二重カウント防止。
--   role はカラム化。1種目1部位は role を1つに確定(primary>secondary>stabilizer)。
CREATE TABLE exercise_muscles (
  exercise_id     TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_group_id TEXT NOT NULL REFERENCES muscle_groups(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,                -- 'primary'|'secondary'|'stabilizer'(部位ごと一意)
  contribution    REAL NOT NULL DEFAULT 1.0,    -- 0.0-1.0。primary=1.0/secondary=0.5/stabilizer=0.25既定、種目別上書き可
  PRIMARY KEY (exercise_id, muscle_group_id)    -- ★同一ペアは1行のみ→集計の二重カウント不可
);
CREATE INDEX idx_exercise_muscles_muscle ON exercise_muscles(muscle_group_id);
-- seed取込時: free-exercise-db の primary/secondary が重複したら primary を採用して dedupe。

-- ============ ワークアウトセッション(=GH同期の単位) ============
CREATE TABLE workout_sessions (
  id               TEXT PRIMARY KEY,            -- ULID(GH notesに埋め相互参照)
  date             TEXT NOT NULL,               -- 'YYYY-MM-DD'(JST, 集計用)
  started_at       INTEGER NOT NULL,            -- unixepoch UTC → GH interval
  ended_at         INTEGER,
  title            TEXT,                         -- 'Push Day A'
  template_id      TEXT REFERENCES workout_templates(id) ON DELETE SET NULL,
  note             TEXT,
  bodyweight_kg    REAL,                         -- 当日体重(自重1RM/kcal推定用, body_metricsから自動プレフィル)
  total_volume_kg  REAL NOT NULL DEFAULT 0,      -- 派生の非正規化キャッシュ(集計は入力生値→kg換算後に積算)
  active_duration_sec INTEGER,                   -- 派生(GH push用)
  est_calories     INTEGER,                      -- METs推定(§8.4)
  status           TEXT NOT NULL DEFAULT 'in_progress', -- 'in_progress'|'completed'
  source           TEXT NOT NULL DEFAULT 'app',
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_workout_sessions_date ON workout_sessions(date);
CREATE INDEX idx_workout_sessions_status ON workout_sessions(status); -- ★未完了セッション検出(§9.3再開UX)

-- ============ セッション内の種目エントリ ============
CREATE TABLE workout_exercises (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id    TEXT NOT NULL REFERENCES exercises(id),
  order_index    INTEGER NOT NULL,
  superset_group INTEGER,                        -- 同値=スーパーセット
  note           TEXT
);
CREATE INDEX idx_workout_exercises_session ON workout_exercises(session_id);

-- ============ セット明細(最多行) ============
CREATE TABLE workout_sets (
  id                  TEXT PRIMARY KEY,
  workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_index           INTEGER NOT NULL,
  set_type            TEXT NOT NULL DEFAULT 'main', -- 'warmup'|'main'|'drop'|'backoff'|'amrap'|'failure'
  load_mode           TEXT NOT NULL DEFAULT 'weighted', -- ★セット単位の荷重形態(レビュー指摘):
                                                   --   'weighted'(外部加重: entry_value=加重量, 自重種目なら加重ベルト+10kg等)
                                                   --   'bodyweight'(純自重: entry_value=NULL/0)
                                                   --   'assisted'(アシスト: entry_value=補助量の絶対値・正の数)
                                                   --   符号規約(±)は事故源なので不採用、明示カラムで区別。
                                                   --   既定は exercises.is_bodyweight=1 なら 'bodyweight'、それ以外 'weighted'。
  entry_value         REAL,                        -- ★入力生値(正本)。lb入力なら185のまま。load_mode='assisted'時は補助量(正)
  entry_unit          TEXT NOT NULL DEFAULT 'kg',  -- ★'kg'|'lb' 入力単位(正本)
  weight_kg           REAL,                        -- 派生キャッシュ: weighted時の加重量の kg 換算(表示/横断比較用)。
                                                   --   ★実効荷重(集計・e1RM・PR)は §8.1 load_kg を使う。
                                                   --   bodyweight/assisted では weight_kg は load_kg と一致しない(weight_kg は実効荷重ではない)
  reps                INTEGER,
  rpe                 REAL,                        -- 6.0-10.0(0.5刻み)
  rest_sec            INTEGER,
  is_completed        INTEGER NOT NULL DEFAULT 1,  -- テンプレprefill時の消化フラグ
  performed_at        INTEGER,                     -- セット完了時刻(intraday HR突合用)
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_sets_we ON workout_sets(workout_exercise_id);
CREATE INDEX idx_sets_exercise_time ON workout_sets(workout_exercise_id, performed_at); -- 前回値プレフィル高速化

-- ============ PR台帳(セット保存時に派生再計算) ============
CREATE TABLE personal_records (
  id              TEXT PRIMARY KEY,
  exercise_id     TEXT NOT NULL REFERENCES exercises(id),
  record_type     TEXT NOT NULL,                 -- 'e1rm'|'weight_at_reps'|'max_reps_at_weight'|'max_volume_session'
  rep_bucket      INTEGER,                        -- weight_at_reps用(1,3,5,8,10,12)
  value           REAL NOT NULL,                  -- ★全 record_type を kg 正規化値(§8.1 load_kg基準)で格納(§8.2)
  unit            TEXT NOT NULL DEFAULT 'kg',     -- 常に 'kg'(表示時のみ主単位へ換算)
  is_provisional  INTEGER NOT NULL DEFAULT 0,     -- ★RPEレス等で全力か不明な暫定PR(§8.2 RPE精度ルール)
  pr_basis        TEXT,                            -- ★確定根拠 'rpe_backed'|'amrap'|'failure'|'rpe_less'(§10.4で返す)。
                                                   --   PR派生再計算時に is_provisional と同時確定・永続化(achieved_set_id失効に依存しない自己完結値)
  achieved_set_id TEXT REFERENCES workout_sets(id) ON DELETE SET NULL,
  achieved_at     INTEGER NOT NULL
);
CREATE INDEX idx_pr_exercise ON personal_records(exercise_id, record_type);

-- ============ ワークアウトテンプレート(PPL等。実績と同形だが値は目安) ============
CREATE TABLE workout_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  region_focus TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE template_exercises (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  exercise_id  TEXT NOT NULL REFERENCES exercises(id),
  order_index  INTEGER NOT NULL,
  target_sets  INTEGER,
  superset_group INTEGER
);
CREATE TABLE template_sets (
  id                   TEXT PRIMARY KEY,
  template_exercise_id TEXT NOT NULL REFERENCES template_exercises(id) ON DELETE CASCADE,
  set_index            INTEGER NOT NULL,
  target_entry_value   REAL,
  target_entry_unit    TEXT NOT NULL DEFAULT 'kg',
  target_reps          INTEGER,
  target_rpe           REAL,
  set_type             TEXT NOT NULL DEFAULT 'main'
);

-- ============ 食事 ============
CREATE TABLE meals (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,                   -- 'YYYY-MM-DD'(JST)
  logged_at     INTEGER NOT NULL,
  meal_type     TEXT NOT NULL,                    -- アプリ内6種:Breakfast|MorningSnack|Lunch|AfternoonSnack|Dinner|Anytime
  note          TEXT,
  photo_r2_key  TEXT,                             -- 将来用(MVPは常にNULL)
  input_method  TEXT NOT NULL DEFAULT 'manual',   -- ★入力方法 'manual'|'photo'|'preset'(旧 source から改名: 全食事は authoring=app なので源泉でなく入力方法を持つ)
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_meals_date ON meals(date);
-- 注: source 語彙の表間規約 — authoring 由来を区別する列(body_metrics.source='google_health'|'app')と、
--     入力UIを区別する列(meals.input_method, workout_sessions は常に app 起点)は意味が別。混同しない。

-- ============ 食事の食材明細(PFCをアプリ側で完全保持) ============
CREATE TABLE meal_items (
  id            TEXT PRIMARY KEY,
  meal_id       TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  preset_id     TEXT REFERENCES meal_presets(id) ON DELETE SET NULL,
  food_name     TEXT NOT NULL,
  quantity      REAL NOT NULL DEFAULT 1,
  unit          TEXT NOT NULL DEFAULT 'serving',
  calories_kcal REAL NOT NULL,
  protein_g     REAL NOT NULL DEFAULT 0,
  fat_g         REAL NOT NULL DEFAULT 0,
  carbs_g       REAL NOT NULL DEFAULT 0,
  fiber_g       REAL, sugar_g REAL, sodium_mg REAL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_meal_items_meal ON meal_items(meal_id);
-- 手入力負荷軽減(§9.4): food_name+PFC のオートコンプリート源として meal_items を food マスタ的に流用。
CREATE INDEX idx_meal_items_foodname ON meal_items(food_name);

-- ============ 食事プリセット(KV→D1へ移行) ============
CREATE TABLE meal_presets (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  items_json        TEXT NOT NULL,               -- 明細スナップショット
  default_meal_type TEXT NOT NULL DEFAULT 'Anytime',
  use_count         INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ============ 体組成(GHミラー + 手動) ============
CREATE TABLE body_metrics (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,                    -- 'YYYY-MM-DD'(JST)
  measured_at   INTEGER NOT NULL,
  entry_value   REAL,                              -- ★手入力時の生値
  entry_unit    TEXT,                              -- ★'kg'|'lb'(手入力時)
  weight_kg     REAL,                              -- 派生/ミラー正規化値
  body_fat_pct  REAL,
  source        TEXT NOT NULL,                     -- 'google_health'(ミラー, read-only)|'app'(手動, D1正本)
  gh_external_id TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX idx_body_metrics_gh ON body_metrics(gh_external_id) WHERE gh_external_id IS NOT NULL;
CREATE INDEX idx_body_metrics_date ON body_metrics(date);

-- ============ 周径(将来拡張, §1.4) ============
CREATE TABLE body_measurements (                  -- M2+で有効化。authoring=app, GHに器なし
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  site          TEXT NOT NULL,                     -- 'waist'|'arm_l'|'arm_r'|'chest'|'thigh_l'|'thigh_r'|...
  value_cm      REAL NOT NULL,
  note          TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_body_measurements_date ON body_measurements(date, site);

-- ============ 睡眠ミラー(GH SoT) ============
CREATE TABLE sleep_logs (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,                    -- 起床日基準
  start_at      INTEGER NOT NULL, end_at INTEGER NOT NULL,
  total_min     INTEGER NOT NULL,
  deep_min INTEGER, light_min INTEGER, rem_min INTEGER, awake_min INTEGER,
  efficiency    REAL,
  source        TEXT NOT NULL DEFAULT 'google_health',
  gh_external_id TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX idx_sleep_gh ON sleep_logs(gh_external_id) WHERE gh_external_id IS NOT NULL;
CREATE INDEX idx_sleep_date ON sleep_logs(date);

-- ============ その他センシング日次ミラー(SpO2/HRV/皮膚温/安静時心拍/VO2max等) ============
CREATE TABLE daily_metrics (
  date          TEXT NOT NULL,
  metric        TEXT NOT NULL,                    -- 'spo2_avg'|'resp_rate'|'hrv_rmssd'|'skin_temp_c'|'resting_hr'|'vo2max'|'steps'(§5.4マスタ表と一致)
  value         REAL NOT NULL,
  unit          TEXT NOT NULL,                    -- '%'|'/min'|'ms'|'celsius'|'bpm'|'ml/kg/min'|'count'
  source        TEXT NOT NULL DEFAULT 'google_health',
  gh_external_id TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (date, metric)                       -- ★冪等: 同日同メトリックはupsert上書き
);

-- ============ GH同期台帳(食事/ワークアウトのpush状態) ============
CREATE TABLE gh_sync_state (
  entity_type    TEXT NOT NULL,                   -- 'workout'|'meal'|'body_metric'
  entity_id      TEXT NOT NULL,                   -- workout_sessions.id / meals.id / body_metrics.id
  gh_datapoint_id TEXT,                            -- GHが返したdata point resource name
  gh_data_origin TEXT,                             -- 書込みdataSource識別(reconcileで自分の書込み判別)
  sync_status    TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'synced'|'failed'|'stale'|'deleted_remote'|'skipped_flag_off'
  last_pushed_hash TEXT,                            -- pushしたpayloadのcontent hash(運動のpatch抑制用。食事は常にdelete+create)
  last_pushed_at INTEGER,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (entity_type, entity_id)
);

-- ============ daily batch 同期状態 ============
CREATE TABLE sync_runs (
  data_type            TEXT PRIMARY KEY,           -- GH dataType単位
  last_synced_at       INTEGER,
  last_cursor          TEXT,                        -- pageToken/最終取得時刻(途中再開, §12.2)
  last_status          TEXT NOT NULL DEFAULT 'idle',-- 'idle'|'running'|'ok'|'error'
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
);
```

種目→部位のseed(`migrations/0002_seed.sql`)で BIG3 + 主要種目を投入(取込時 primary/secondary dedupe)。日本語名は LLM バッチ翻訳で `name_ja` 補完(§14#12)。`muscle_groups.weekly_target_sets` と `nutrition_targets` 初期値もシード。

---

## 8. ドメインロジック

### 8.1 ボリューム(レビュー指摘: 荷重形態と片側/合計規約を明示)
セット1本の「動かした総重量(effective load, kg)」を `load_mode` と `load_basis` から一意に決める:

```
limb_mult   = (load_basis ∈ {per_limb, per_side}) ? 2 : 1     // ダンベル/片側マシンは両側合算
load_kg(set) =
  load_mode='weighted'    → (entry→kg) × limb_mult + (is_bodyweight ? bodyweight_kg × bw_factor : 0)
  load_mode='bodyweight'  →                          bodyweight_kg × bw_factor
  load_mode='assisted'    → max(0, bodyweight_kg × bw_factor − (entry→kg) × limb_mult)   // アシストは体重から減算
set_volume(set) = load_kg(set) × reps
```
- **片側/合計規約**: 入力生値は §7.0 通り変換せず保存(ダンベルは「片手20kg」をそのまま表示)、ボリュームのみ `load_basis` 乗数で正規化。これでレビューの「合計で統一したい」要求(集計の一貫性)を、表示の素直さを犠牲にせず満たす。`laterality` は参考メタとして残すが、ボリューム乗数の根拠は `load_basis` に一本化(二重適用しない)。
- **自重/加重/アシスト**(レビュー指摘): ディップス自重8回=`bodyweight`、加重ベルト+10kg=`weighted`(entry_value=10)、マシンアシスト−15kg=`assisted`(entry_value=15)を同一種目内でセット毎に区別できる。
- セッション総ボリューム `total_volume_kg` = Σ(main+drop+backoff+amrap+failure)。**warmupは除外**(過大評価防止)。D1はウィンドウ集計が遅くなりがちなので `workout_sessions.total_volume_kg` に非正規化キャッシュ(保存後の派生再計算で更新, §8.5)。
- **MCP/AIには素データと正規化済みの両方を返す**(§10.4): 各セットに `entry_value`+`entry_unit`+`load_mode`+`load_basis` と、計算済み `load_kg`/`set_volume` を同梱し、コンシューマ(トレーナーAI)が乗数算術を再実装せずに済むようにする。

### 8.2 推定1RM(e1RM)
- 既定 **Epley** `1RM = w × (1 + reps/30)`、代替 Brzycki。`settings.e1rm_formula` で切替。w は §8.1 の `load_kg(set)`(片側/自重正規化後)を用い、表示時に kg/lb 換算(§7.0 ドリフト回避)。
- **reps ≤ 12 のセットのみ e1RM対象**(13rep以上はEpley誤差増のためPR検知除外/参考値)。
- **e1RM の権限分担(レビュー懸念4への回答)**: 二箇所で計算されうるが役割を固定して衝突を防ぐ —
  - **サーバー(`personal_records` の `record_type='e1rm'` 行)= 確定値**。`settings.e1rm_formula` で計算し、UI表示と **PR検知の唯一の正**。AIが「PR更新した」と言うときは必ずこの台帳値を正とする。
  - **MCP/AI = 補助計算可**。`get_exercise_history`(§10.4)が返す素データから独自にe1RMやトレンドを算出してよい(分析の自由)。ただし式は `settings.e1rm_formula`(get_settingsで取得可)に合わせるのを既定とし、台帳とズレたら台帳を優先と明記。これで「私の計算値とPR台帳がズレて混乱」を回避。
  - **確定/暫定の伝播(検証指摘)**: 台帳には `is_provisional=1`(RPEレス由来等)の行が確定行と同居する。`get_personal_records` は **`is_provisional`/`pr_basis` を必ず返す**ので、AIが「PR更新した」と言うときは **確定PR(is_provisional=0)を優先**し、暫定PRは「参考値・要RPE裏取り」と明示する。`confirmed_only=true` で確定行のみに絞れる。`pr_basis`/`is_provisional` は PR派生再計算時に `achieved_set_id` の rpe/set_type から確定して**永続化**(列削除に依存しない)。
- **PRの単位規約(監査指摘: kg/lb混在対応)**: 全 `record_type`(e1rm / weight_at_reps / max_reps_at_weight / max_volume_session)の `value` は **kg 正規化値(§8.1 load_kg 基準)で格納、`unit='kg'` 固定**(表示時のみ主単位へ換算)。生値はあくまで `achieved_set_id` 経由で参照。`max_reps_at_weight` の「同一重量」判定は **kg正規化後に ±0.5kg の丸め許容幅**で同値とみなす(185lb=83.9kg と 84kg を同一バケット扱い)。これでlbマシンとkgバーベルが混在してもPR検知が成立する。
- **RPEとe1RM精度ルール(レビュー懸念5への将来メモ)**: `rpe` は nullable(入力寛容を優先)。RPE/RIR 無しセットは全力か余裕ありか判別不能なので **e1RM は参考値扱い**。**PR確定は RPE付き or `set_type ∈ {amrap, failure}` のセットを優先**し、RPEレスのみで更新する場合は「暫定PR」フラグを立てる。停滞検知・デロード提案(§8.6 M4)はこの優先度を用いて精度を上げる。MVPでは参考値も含めて検知し、フラグで区別するに留める。

### 8.3 部位別週間ボリューム + ヒートマップ(§9.5でUI、ここでロジック)
ヒートマップ stimulus score(直近N日, 既定N=7):
```
stimulus(muscle, window) =
  Σ_set [ effective_volume(set)
          × contribution(exercise, muscle)        // primary≈1.0 / secondary≈0.5(1ペア1roleで二重計上不可)
          × set_type_weight                        // warmup=0.3, main=1.0, drop/backoff=0.8, failure=1.1
          × recency_decay(days_ago) ]              // exp(-ln2 × days_ago / half_life), half_life≈window/2
```
- 集計の前提(レビュー指摘): `exercise_muscles` は (exercise_id, muscle_group_id) が PK で1ペア1行のため二重カウント不可。万一データ不整合があっても muscle_group ごとに最大 role を採用するルールを集計クエリに明記。
- 正規化2モード: ① 相対(窓内全部位のmin-max/95%ile, 「今週どこを多くやったか」) ② **目標基準**(`actual_sets / muscle_groups.weekly_target_sets`, 弱点部位の可視化)。**目標値は `muscle_groups.weekly_target_sets` から引く**(レビュー指摘の欠落テーブルを §7 で追加済)。**ヒートマップ=減衰あり / 週間ボリューム表=減衰なし合計**で使い分け。
- 色マップ: intensity 0→1 を 青(不足)→緑→黄→赤(高刺激)。`muscle_groups.svg_region_id` でSVGパスへ流し込み、前面/背面トグル。

### 8.4 消費カロリー推定(METs)
GH push用 `est_calories`(GHは手動exerciseにカロリー自動付与しない):
- `kcal = METs × 3.5 × bodyweight_kg / 200 × duration_min`
- MET値: 中強度レジスタンス≈5.0、軽め/マシン≈3.5、高強度サーキット≈6.0。
- **あくまで保守的推定**(過大評価しない)。体重(GH SoT)との収支ビュー用の参考値。

### 8.5 書き込み経路一本化と D1 原子性(レビュー major への対応)
全write は `packages/core/services/*` を1点経由(UI/MCP双方とも直Provider叩き禁止)。

**D1 の交差(制約)**【確定, 出典 d1/best-practices】: D1 はインタラクティブなマルチステートメントトランザクション(BEGIN/COMMIT/ROLLBACK)を提供せず、**原子性が保証されるのは単一 `db.batch()` 呼び出しのみ**(制約/トリガ違反でのみ自動ロールバック、JS側ロジックで途中失敗させると部分コミットが残りうる。各文・全体に 100KB/30秒の上限)。

**設計ルール**:
1. **セッション保存・テンプレ展開・編集(食事=delete+recreate)は必ず単一 `db.batch()` に収める**。順序依存は batch 内 SQL 順序 + `ON CONFLICT` で吸収。途中失敗で「sets だけ入って親が無い」を構造的に防ぐ。
2. **PR台帳更新と `total_volume_kg` 等の派生は、保存後の非トランザクション派生再計算に倒す**(または batch 内 SQL に閉じる)。派生がズレても正本(sets)は無事で、再計算で回復可能。
3. **GH push(外部I/O)は batch に入れない**。`D1 batch 成功 → gh_sync_state=pending → 別経路(同期呼び出し or cron retry)で best-effort push`。push 成否は **D1正本に一切影響させない**。
4. **巨大セッション対策**: 多種目で 100KB/30秒に近づく場合は batch を分割(親 session を先に1 batch でコミット → 種目/セットを追記 batch)。分割時も親が先・子が後で参照整合を保つ。

```
WorkoutService.completeSession():
  1) db.batch([ session upsert, exercises upsert, sets upsert ])  // 原子
  2) 派生再計算(total_volume, PR) を別呼び出しでupsert            // 回復可能
  3) gh_sync_state(workout) = pending
  4) GoogleHealthProvider.pushExerciseSummary(...) best-effort     // 失敗→pending据置, cron retry

NutritionService.logMeal() / editMeal():
  1) db.batch([ meal upsert, meal_items 全削除+再INSERT ])         // 原子(編集も同形)
  2) gh_sync_state(meal) = (flag OFF なら 'skipped_flag_off' / ON なら 'pending')
  3) flag ON時のみ GH push:
       新規/編集とも anonymous food は immutable → batchDelete(旧gh_datapoint_id) + create(新)
       → gh_sync_state.gh_datapoint_id を差し替え(§9.7 と整合)
```

- **idempotency**: クライアント発番 UUID を各エンティティ id に使い UNIQUE で二重INSERT を弾く。**加えて業務キーの緩い重複警告**(§8.7)。
- GH `notes` に逆引きタグ埋め込み: `notes = "<ユーザーメモ>\n\n[ghsidecar:session=<ULID>;v=1]"`(reconcileでID不一致時の二重化防止、表示時に正規表現で剥がす)。
- CRUD伝播: session完了→create。サマリに影響する編集(duration/kcal変化)→**運動は `last_pushed_hash` 比較で patch**(無駄なPATCH抑制)。**食事は anonymous immutable なので常に batchDelete+create**(hash最適化は食事に不適用, §5.2)。削除→batchDelete。push失敗は `pending/failed` でcronリトライ。
- **競合解決は常にD1-wins**(双方向マージ排除)。

### 8.6 差別化ビュー(ガチ勢価値, ロードマップ割当を明示)
レビュー指摘でスコープ膨張を防ぐため §13 へ割当:
- **MVP(M1)**: PR更新検知タイムライン / 体重・ボリューム・PFC の単純トレンド表示。
- **将来(M4以降)**: e1RM回帰直線での停滞検知→デロード提案 / 体重(GH)× PFC(D1)× 週間トレボリューム(D1)× 推定消費kcal の統合相関ビュー(周径も軸に) / HRV・安静時心拍・睡眠 × 直近トレ刺激でオーバーリーチ警告。
- 統合相関ビューは GH単体でも既存MCP単体でも作れない、二層統合の正当化そのもの。

### 8.7 二経路重複登録の去重(レビュー major への対応)
UI(IndexedDBアウトボックス)と MCP(Claude経由)が同一の食事/ワークアウトを別経路で authoring すると、別 UUID 発番のため UNIQUE では弾けない(例: ジムでオフライン下書き→帰宅後 Claude に「さっきのトレ記録して」で二重)。対策:
- **業務キーの緩い重複警告を services 層に実装**: 食事=`date + meal_type`、ワークアウト=`session開始時刻の近接 + title`。一致候補があれば services が返し、**UI側に「類似記録あり、統合しますか」を提示**(完全自動マージはせず D1-wins 方針と整合)。
- 代替/併用案: **MCP は新規 authoring を絞り、既存 D1 エントリの参照・追記・写真解析のみ**とし、新規登録の入口を UI に一本化する(§10.2 に明示)。MVP は前者(警告)を実装、後者は運用で判断。

---

## 9. UI/UX(PWA)

### 9.1 ナビゲーション(モバイルファースト)
下部固定タブ5枚 + 中央FAB。iOS home-screen追加時のセーフエリア対応必須。
```
┌──────────────────────────────┐
│        [ アクティブ画面 ]         │
├──────────────────────────────┤
│ 今日   履歴   (＋)   図鑑   設定  │ ← 中央＋=記録FAB(ワークアウト/食事/体重)
└──────────────────────────────┘
```
「設定」タブで `settings`(主単位 kg/lb・e1RM式)と `nutrition_targets`(フェーズ・目標マクロ)を編集(要件4・8の裏付けテーブルに対応)。

### 9.2 今日(Today)
```
┌──────────────────────────────┐
│ 2026-05-31 (土)               │
│ ┌── 体重(GH)─┐┌── 睡眠(GH)──┐ │ ← デバイス測定はread-only, 出所バッジ"Google Health"
│ │72.4kg/159.6lb││7h12m 深1h20m│ │   (手入力値しか無い日は編集可表示, §2.1)
│ └────────────┘└────────────┘ │
│ ┌── 記録中のワークアウト ──────┐ │ ← status='in_progress'検出時のみ(§9.3)
│ │ 胸の日 02:14経過 [再開][破棄]│ │
│ └──────────────────────────┘ │
│ ┌── 今日のワークアウト ────────┐ │ ← authoring=app, 編集可
│ │ 胸の日·5種目·18セット         │ │
│ │ 総ボリューム 8,420kg/18,564lb │ │
│ │ [続きを記録]                  │ │
│ └──────────────────────────┘ │
│ ┌── 今日の食事 P130 F60 C210 ──┐ │ ← 分母は nutrition_targets から
│ │ 1,980/2,200 kcal [写真で追加]│ │
│ └──────────────────────────┘ │
│ ┌── 直近7日 筋ヒートマップ ─────┐ │ ← body-highlighter
│ │ [前面SVG] [背面SVG] 胸=濃赤  │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

### 9.3 ワークアウト記録(最重要UX)+ 中断再開(レビュー major への対応)
```
┌──────────────────────────────┐
│ ← 胸の日           02:14 経過 ⏱  │
│ ┌── ベンチプレス ───────── ⋮ ──┐│ ← ⋮で編集/削除/入替
│ │ 前回: 80kg×8,8,7 (5/27)      ││ ← 前回値プレフィル元(入力生値で再現→端数化しない)
│ │ Set 重量      レップ RPE  ✓   ││
│ │  1 │80.0kg│ 8 │8│ ☑          ││ ← ✓で完了→休憩タイマー自動起動
│ │  2 │80.0kg│ 8 │8│ ☑          ││
│ │  3 │80.0kg│ 7 │9│ ☐          ││ ← 入力中(プレフィル済)
│ │ 単位:[kg]‹›[lb]  +セット追加  ││ ← 行内表示は両併記
│ │ ボリューム: 1,840kg/4,057lb   ││ ← 自動計算
│ └──────────────────────────┘│
│ [＋ 種目を追加]                  │
│ ┌── 休憩 01:30 ▓▓▓▓░░ +30s ──┐│ ← 満了でvibrate+Web Audio(プッシュ不要)
│ └──────────────────────────┘│
│ [セッションを終了して保存]          │
└──────────────────────────────┘
```
- **中断・再開**(レビュー指摘): 起動時/Today で `status='in_progress'` セッションを検出 →「記録中のワークアウトがあります 再開/破棄」バナー。同日に既存 in_progress があれば「追記 vs 新規」を選択。`started_at` から24h 経過の放置セッションは自動 `stale` 化(誤って巨大セッションが残るのを防止)。
- 種目選択: 検索/お気に入り/最近/部位フィルタ(ヒートマップと同語彙)。各種目に部位プレビュー小SVG。
- 単位トグル: グローバル既定(`settings.unit_preference`)+ カード内一時切替。表示は常に `80.0 kg / 176.4 lb` 両併記。**入力生値+単位を保存**(§7.0)。入力刻みは単位追従(kg: 0.5/1.25/2.5、lb: 1/2.5/5)。
- 保存: 1ワークアウトとして D1(真の記録, §8.5 batch)+ GH push(サマリ, best-effort)。

### 9.4 食事記録(UI完結性の明示, レビュー minor)
```
┌──────────────────────────────┐
│ ← 昼食                          │
│ ┌── 写真で記録(MCP経由) ───────┐│ ← MVPはClaudeアプリ側で解析(§14#14)
│ │ ※PWA単体では自動栄養計算不可  ││   UI内自動解析は将来(Workers AI/Claude API)
│ └──────────────────────────┘│
│ ┌── プリセットから ────────────┐│ ← D1 meal_presets(MVPのUI主役)
│ │ ★朝の定番 ★プロテイン1杯      ││
│ │ [+今の食事をプリセット保存]    ││
│ └──────────────────────────┘│
│ ┌── 手入力(食品名/量/PFC/kcal) ─┐│ ← food_name入力でmeal_items由来の
│ │ 例:「鶏胸肉」→過去PFC自動補完  ││   オートコンプリート(手入力負荷軽減)
│ └──────────────────────────┘│
└──────────────────────────────┘
```
- **UI完結性の制約を明示(レビュー指摘)**: MVP の UI 食事登録は**「プリセット + 手入力」で完結**。写真解析は MCP 経由(Claudeが視覚解析→items[])であり、PWA単体では自動栄養計算不可である旨をユーザー向け制約として明示。
- **手入力負荷軽減**: 過去入力した `food_name`+PFC を `meal_items` から food マスタ的に再利用するオートコンプリートを MVP に入れる(毎回フルマニュアルを回避)。
- UI 直写真解析(Workers AI / Claude API 直叩き)は §13 の M4+ 将来拡張。

### 9.5 種目図鑑 + ヒートマップ(要件7主役)
- タップ式人体SVG(前面/背面)で部位絞込 → 該当種目リスト(主:胸 副:三頭等)。
- 種目詳細: 画像/手順 + **その種目専用ミニヒートマップ**(primary濃/secondary淡)+「ワークアウトに追加」。
- データ裏付け: `exercises × exercise_muscles(role/contribution, 1ペア1行) × muscle_groups.svg_region_id`。
- 目標基準ヒートマップは `muscle_groups.weekly_target_sets` を分母に弱点部位を可視化(§8.3)。

### 9.6 履歴・トレンド
体重/ボリューム/PFC/睡眠タブ。体重トレンド(Recharts LineChart, 主単位主・副単位副)。ワークアウト履歴行は左スワイプで編集/削除。

### 9.7 編集/削除UX共通(要件4)
- 一覧は**左スワイプで編集/削除**。削除は確認 + アンドゥトースト(5秒)。
- 編集はインライン/ボトムシート。**Optimistic UI は D1 commit 成功(§8.5 batch)で確定扱い**。GH push は best-effort 非ブロッキングなので UI ロールバック単位に含めない。
- **食事編集の内部挙動を明示(レビュー指摘)**: D1 の `meals` は同一 id のまま UPDATE(明細は §8.5 の delete+再INSERT batch)。GH 側だけ anonymous datapoint を batchDelete→再create し `gh_sync_state.gh_datapoint_id` を差し替える。UI の楽観更新は D1 確定基準。
- センシングデータ(体重デバイス測定/睡眠)は **read-only**(§2.1)。体重手入力値のみ編集可で、GHへ best-effort 書き戻す旨を明示。

### 9.8 PWA技術
- manifest: `display:"standalone"`, `orientation:"portrait"`, アイコン192/512/maskable。
- Service Worker: vite-plugin-pwa(generateSW)でアプリシェルprecache。
- **オフライン下書き(必須級)**【判断】: ジムは電波弱、かつ食事/ワークアウトはauthoring元=取りこぼすと真実が消える。記録は IndexedDB アウトボックス→TanStack Query Mutationキュー→Background Sync(iOS未対応時は `online`イベント/起動時フラッシュfallback)。冪等キー(クライアントUUID)で重複送信を弾く。二経路重複は §8.7 の業務キー警告で補完。
- インストール導線: Android=`beforeinstallprompt`捕捉、iOS=非standalone検知して「共有→ホーム画面に追加」を一度案内。

### 9.9 kg/lb(要件8)
- 定数: kg→lb `× 2.2046226218`、lb→kg `× 0.45359237`(国際協定の定義値で往復誤差最小)。
- **保存は入力生値+単位(`entry_value`/`entry_unit`)が正本**(§7.0)。`weight_kg` は横断比較用の派生キャッシュ。lb入力した重量は lb のまま保持し、前回値プレフィルで端数化しない。**集計(ボリューム/e1RM/PR)は §8.1 `load_kg` でkg正規化してから行う**(生値系での積算はkg/lb混在で破綻するため不可、監査指摘)。
- 表示: 主単位(`settings.unit_preference`)+副単位常時併記。チャート軸は主単位、ツールチップで両方。

### 9.10 採用ライブラリ【確定: ライセンス・更新日確認済】
- ヒートマップ: **`body-highlighter`(lahaxearnaud, MIT, v3.0.2/2025-11, framework-agnostic)** 第一候補。不満なら `react-native-body-highlighter`(MIT, v3.2.0/2026-04, 24部位)のSVGポリゴンを抽出し自前ラッパ化(半日〜1日)。`react-body-highlighter`本家は2021停止で不採用。
- 種目マスタ: **`free-exercise-db`(yuhonas, Public Domain, 800+種目, primary/secondary muscles/equipment/images/instructions完備)** 一次採用。完全フリーで将来公開時も安全。英語のみが弱点 → `name_ja` をLLMバッチ翻訳補完。取込時 primary/secondary dedupe(§7)。wger(CC-BY-SA, 日本語訳あり)は継承義務が将来公開時に発生するため補助のみ。

---

## 10. MCP統合と既存repo移行戦略

### 10.1 既存資産の仕分け
要件6「互換性は重視しなくてよい」=「MCPツールのI/O契約は維持不要(Claude.aiの既存接続が壊れて構わない)」だが**設計資産は最大限再利用**と解釈。

| 資産 | 判断 |
|---|---|
| `HealthProvider` 抽象(read+write) | 持ち込み(コア化)。Fitbit→GH切替の単一接合点。将来 strength フィールド追加に備え疎結合 |
| `FitbitProvider` | 持ち込み(暫定維持、M3まで。read検証/フォールバック) |
| `GoogleHealthProvider` | **新規実装**(本プロジェクトの主目的) |
| Zodモデル | 持ち込み(再編)。**ドメインモデル(D1準拠)とプロバイダDTO(各API形)に二層分離** |
| OAuth Pattern B | 持ち込み(Google化)。失効60s前refresh流用、両Worker共通 getAccessToken |
| 食事preset(KV `preset:`) | **作り替え(D1へ昇格)**。Fitbit固有のPFC silent drop回避目的が消える |
| MCPツール33個のI/O契約 | 作り替え(D1経由・ドメインサービス経由に再配線) |
| `log_meal_photo` | 持ち込み(MCP最大の価値)。Claudeの視覚解析はUIで代替困難 |
| `@hono/mcp` + Streamable HTTP | 持ち込み |
| MCP保護(secret一次+IP二次) | 持ち込み(IP値・運用を §6.3 で正確化) |
| biome/vitest/wrangler/pnpm | 持ち込み(pnpm workspaceでモノレポ化) |

### 10.2 UI時代のMCP位置づけ
MCPは残すが役割を絞る。**残す価値**: ① `log_meal_photo`(写真→items[]、UIで同等は困難)② 自然言語ワークアウト記録 ③ **トレーナーAIとしての構造化分析read**(コンシューマレビューの核心: get_exercise_history 等で種目軸の時系列をAIが読む)④ 移動中Claudeアプリだけ開いている時のフォールバック。
- Write → 維持・D1経由再配線。**Read は「量を削る」ではなく「UI詳細閲覧用 ≠ AI分析用」で役割分離**(レビュー懸念1への回答): UI向けの細かな閲覧APIはMCPに出さないが、**トレーナーAIが分析に使う構造化readは確実に残す**(§10.4で具体名を確定)。Delete → 直近取消のみ。Preset → 維持・D1化。
- **全ツールD1経由に作り替え必須**(§8.5の一本化遵守)。
- **読み取りのD1/provider境界を確定(レビュー懸念3への回答)**: 数字の一貫性のため発火条件を曖昧にしない —
  - **前日(JST)以前 = 必ず D1**(daily batch でミラー済の確定値)。同じ問いに同じ答え。
  - **当日分の未ミラーなセンシング(体重・睡眠・HRV等)= provider read の「速報」**。返り値に `provenance: 'gh_provisional'` と `as_of` を必ず付け、AI/UIが「当日速報」と明示できる。確定後(翌日のbatch)は D1 値で上書き。
  - **体重の二系統(§2.1)を当日速報にも適用**: 当日 provider 速報の体重は**デバイス測定の速報**であり、D1 にある当日の手入力正本(source='app')とは別物。`source`(device/manual)も併せて返し、§2.1 の dedupe(デバイス測定優先)を当日速報にも適用して、手入力正本と速報を混同させない。
  - 食事・ワークアウトは常に D1(authoring=app なので provider 由来は無い)。
- **二経路重複の方針(レビュー指摘)**: §8.7 の業務キー警告を services 層で共有。MCP の新規 authoring を絞り「既存 D1 エントリの参照・追記・写真解析のみ」に寄せる選択肢も明示(新規登録入口を UI 一本化)。どちらを採るかは運用で判断、最低限 MVP は重複警告を実装。

### 10.3 ディレクトリツリー(モノレポ)
```
google-health-sidecar/
├─ pnpm-workspace.yaml / package.json / biome.json / tsconfig.base.json
├─ packages/core/                      # 3面共有の唯一のドメイン層
│  └─ src/
│     ├─ domain/   (models.ts, enums.ts, schema.zod.ts)
│     ├─ providers/ (HealthProvider.ts, fitbit/, google-health/{client,mappers,scopes,discovery-pin}, dto/)
│     ├─ services/  (WorkoutService, NutritionService, BodyService, SyncService) ← 全write 1点経由
│     ├─ db/        (migrations/, repositories/, client.ts, batch-helpers.ts) ← 原子性ヘルパ
│     ├─ auth/      (tokenStore.ts[KV+LOCK], googleOAuth.ts, getAccessToken共通)
│     ├─ presets/   (exercise-catalog.ts)
│     └─ util/      (rate-limit, cache, units[kg↔lb生値], errors)
├─ apps/
│  ├─ web/   (UI Worker + cron相乗り; wrangler.jsonc, index.ts[fetch+scheduled×2], api/, auth/, cron/, ui/)
│  └─ mcp/   (MCP Worker; wrangler.jsonc, index.ts[@hono/mcp], guard.ts, tools/{read,write,photo,preset})
└─ tools/    (oauth-bootstrap.ts: 初回OAuth取得CLI; oauth-playground-check.ts: nutrition write 200/403検証)
```
`apps/web` と `apps/mcp` はビジネスロジックを持たず `packages/core/services/*` を呼ぶ薄いアダプタ。これが書き込み経路一本化を構造的に強制する。

### 10.4 MCPツール確定インターフェース(レビュー懸念1への回答: トレーナーAIが使う面)
旧33ツールのI/O契約は破棄(要件6)し、**D1経由 + ドメインサービス経由**で再定義する。**最優先方針: トレーナーAIの中核read(種目軸の時系列・PR・部位別ボリューム・頻度)は UI とは独立に必ず提供する**。全read は §10.2 のD1/provider境界に従い、返り値に `provenance` を付す。

**Read(分析・トレーナーAI向け) — 必須セット**

| tool | 主な引数 | 返す中身(構造化) | 用途 |
|---|---|---|---|
| `get_exercise_history` ★中核 | `exercise`(id/名前), `since?`,`limit?` | 種目の**全セット時系列**: セッション日付ごとに `[{set_index,set_type,entry_value,entry_unit,load_mode,load_basis,reps,rpe,load_kg,set_volume,e1rm_raw}]`。e1RM素データ込み | トレーナーAIの分析の生命線。AIが独自にe1RM/トレンド/停滞を計算(§8.2権限分担) |
| `get_personal_records` | `exercise?`, `confirmed_only?` | PR台帳(`record_type, value, unit, rep_bucket, achieved_at, achieved_set_id, is_provisional, pr_basis`)。**PR主張の正**だが確定/暫定を `is_provisional` で必ず区別(§8.2)。`pr_basis ∈ rpe_backed|amrap|failure|rpe_less` | 「PR更新した?」への回答(暫定PRは参考値と明示) |
| `get_muscle_volume` | `window?`(既定7日), `mode?`(相対/目標基準) | 部位別 `{muscle, actual_sets, volume_kg, target_sets, stimulus, vs_target}`(§8.3) | 弱点部位・週間ボリューム分析 |
| `get_training_frequency` | `since?` | 種目/部位別の**最終実施日**・頻度・直近セッション一覧(`session_id, date, title, total_volume, exercises`) | 「胸いつ以来?」「今週何回?」 |
| `get_day` | `date?`(既定今日JST) | その日の食事(PFC合計+明細)・ワークアウトサマリ・体重/睡眠(provenance付) | 日次の俯瞰 |
| `get_sensing` | `metric`(weight/sleep/hrv/resting_hr/spo2/vo2max…), `range` | センシング時系列。**前日以前=D1確定 / 当日=provider速報(provenance明示)** | 「最近のHRV見て」 |
| `get_nutrition_log` | `date?`/`range?` | 食事ログ(D1正本のPFC明細) | 食事分析 |
| `search_exercises` ★解決 | `query`(name_en/name_ja部分一致), `equipment?`,`muscle?`,`favorite?` | 種目候補 `[{id,name_en,name_ja,equipment,laterality,load_basis,is_bodyweight,bw_factor,primary/secondary_muscles,is_custom}]` | 分析の起点。`get_exercise_history` 等のid解決・列挙。bw_factor/load_basisも返すのでAIが§8.1のload_kgを再計算可 |
| `get_settings` | — | `unit_preference, e1rm_formula, nutrition_targets, muscle_groups.weekly_target_sets` | AIが式・目標・単位を合わせる(§8.2/§8.3整合) |

**Write / Photo / Preset / Delete**

| tool | 備考 |
|---|---|
| `log_meal_photo` ★維持 | 写真→Claude視覚解析→`items[]` → NutritionService(D1正本 + GH push best-effort)。MCP最大の価値 |
| `log_meal` / `log_preset` | 自然言語食事登録。D1経由。preset は D1 化 |
| `log_workout` | 自然言語ワークアウト記録(「ベンチ80kg8回3セット」)→ WorkoutService。`load_mode`/`load_basis` も推定して埋める |
| `append_to_workout` | 既存 in_progress/当日セッションへの追記(§8.7 二経路重複の緩和: 新規乱発を避け追記に寄せる) |
| `save_meal_preset` / `delete_meal_preset` | D1 preset 管理 |
| `delete_recent_log` | 直近の食事/ワークアウト/セットの取消のみ(誤記録のundo)。広範な編集は UI に寄せる |

- **設計原則**: write は全て `packages/core/services/*` 経由(§8.5)。read は D1一次 + 当日センシングのみ provider 速報。**全 read が raw + 計算済みの両方を返す**ので、AI は乗数算術やe1RM式の再実装なしに分析でき、かつ独自分析の自由も持つ。
- **単位の明示(監査指摘)**: 生値側 `entry_value` は `entry_unit`(kg/lb)に従うが、**正規化値 `load_kg`/`set_volume`(=set_volume_kg)/`e1rm_raw`(=e1rm_kg)は常に kg 固定**(フィールド名の `_kg` サフィックスを契約とする)。AIが lb生値と kg正規化値を取り違えないようにする。`get_personal_records` の `value` も kg 固定(§8.2)。
- **`provenance` enum(検証指摘)**: `d1_confirmed | gh_provisional`。食事・ワークアウト read は常に `d1_confirmed`(authoring=app)。センシング read は前日以前=`d1_confirmed` / 当日未ミラー=`gh_provisional` + `as_of`(§10.2境界)。AIが機械判定できるよう固定。
- **種目名の解決規約(検証指摘)**: `get_exercise_history` 等で `exercise` に名前を渡す場合、name_en/name_ja の**部分一致**で解決。**複数候補や0件は曖昧エラーで候補配列を返す**(誤った種目の履歴を分析する事故を防止)。確実な解決は `search_exercises` で id を得てから渡す。is_custom 種目も同列に解決。
- **要件6との整合**: 旧ツール名との後方互換は取らない(Claude.aiの既存コネクタは作り直し)。上表が新しい確定契約。実装は M2(apps/mcp 構築)。

---

## 11. セキュリティ

| 面 | 保護方式 | 根拠 |
|---|---|---|
| UI(PWA) | Google OIDC ログイン + 許可メール/sub allowlist | 要件2/3。一致しなければ全拒否 |
| MCP | **一次=URL埋め込み `MCP_SHARED_SECRET`(fail-closed)** + 二次=Anthropic outbound IP allowlist(`160.79.104.0/21`, 公式追従, IP変動時は緩めても secret で防御) | 二重(secret知識+送信元IP)で単一ユーザー十分。IP取り違え/変動による全断を回避 |
| Cron | Cloudflare内部トリガのみ(外部到達不可) | scheduled handlerは公開ルート無し |

- **GH token保管**: KV(TOKENS)継続。**CF管理のat-rest暗号化に依拠**(アプリ層追加暗号化は当面不要=YAGNI、鍵管理コストが脅威低減に見合わない)。将来verification/多端末化時にWebCrypto封筒暗号化を導入。TOKENS書き込みは `auth/tokenStore` 1ファイルに集約し監査面を絞る。
- secret(`GOOGLE_CLIENT_ID/SECRET`, `SESSION_SIGNING_KEY`, `ALLOWED_SUB`, `MCP_SHARED_SECRET`)は Wrangler secrets。`ANTHROPIC_OUTBOUND_CIDR` 等の非秘匿は `vars`。IP値はハードコードせず設定+公式ページ定期確認。
- 割り切り: マルチテナント/行レベル権限/監査ログ本格運用はやらない。CASA不要。

---

## 12. デプロイ・運用・コスト

### 12.1 wrangler.jsonc 骨子(apps/web)
```jsonc
{
  "name": "ghsidecar-web",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist", "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/auth/*"]
  },
  "d1_databases": [{ "binding": "DB", "database_name": "ghsidecar", "database_id": "<id>" }],
  "kv_namespaces": [
    { "binding": "TOKENS", "id": "<id>" },
    { "binding": "CACHE",  "id": "<id>" },
    { "binding": "LOCK",   "id": "<id>" }
  ],
  // cron は account 合計5本制限 → 単一式に集約(5分毎に pull+push+stale, §12.2)
  "triggers": { "crons": ["*/5 * * * *"] },
  "observability": { "enabled": true },
  "vars": { "ALLOWED_EMAIL": "tachibanayu24@gmail.com", "FEATURE_GH_NUTRITION_PUSH": "false" }
  // "r2_buckets": [...] は将来用(進捗写真)にコメント予約
}
```
apps/mcp の wrangler.jsonc は同じD1/KVバインド + `MCP_SHARED_SECRET`/`ANTHROPIC_OUTBOUND_CIDR`、cron無し。

### 12.2 daily batch(scheduled)— cron予算と再入(レビュー major への対応)
**cron予算見積り(概算)**: 読む dataType 8種。多くは daily 系で1日1〜数点(ページング不要)。ページングが要るのは exercise/sleep(pageSize上限25)程度で、単一ユーザー1日分なら各 1〜2ページ。サブリクエスト概算 = 8 dataType ×(reconcile 1 + 追加ページ最大2)≒ 最大 ~24 サブリクエスト/回 + token refresh 1。Workers のサブリクエスト上限(有料1000)に対し**大幅に余裕**、wall-clock も数秒想定。→ **MVP は cron 同期処理で足りる**。

**設計上の安全策**:
- **cron は単一式(`*/5`)に集約**(2026-06-01 実デプロイで判明: Cloudflare 無料プランは **account 合計5本** が cron 上限。当初の4式=pull3+push1 では他プロジェクト分と合算で超過)。枠コストは「式の本数」で頻度ではないため、`*/5` 1本で **5分毎に pull(GH→D1 増分)+ push再送 + stale化を毎回実行**する。これで枠1本のまま当初の日3回 pull より高頻度な同期になる。同期頻度を変えたいときはこの周期だけ変更(枠は1のまま)。GH のデバイス同期遅延的に `*/5` が実効上限(それより速くても新データは増えず 429 リスクのみ)。
- **`sync_runs.last_cursor` で途中再開(再入)**: pull が途中で時間切れ/失敗しても次回 cursor から再開。冪等 upsert なので重複しても安全。高頻度化しても増分のみ取得で軽量。
- **予算超過の予兆が出たら Queues 採用を再評価**(§4.2): dataType 単位ジョブにファンアウトし各ジョブ短時間・独立リトライ。MVP では不要と判断、リスク顕在化時の代替案として明記。

```ts
// 単一 cron(*/5)。pull・push再送・stale化を毎回実行(cron 枠 1 本に集約)。
async scheduled(_controller, env, ctx) {
  const app = makeContext(env);
  ctx.waitUntil((async () => {
    await staleAbandonedSessions(app.db);
    await runDailyPull(app);                  // GH→D1 reconcile(増分)
    await retryPendingPushes(app, { max: 20 }); // 失敗/未送 push の再送(通常は inline 送信)
  })());
  // 以降の pull 詳細(参考: runDailyPull の内部ループ):
  const provider = new GoogleHealthProvider(env);  // 系統BトークンをKV共通getAccessTokenで
  // ★ループ単位は §5.4 マスタ表の「GH dataType ID」粒度(内部キー=GH dataType ID)。
  //   resp-rate/skin-temp は dataType ID がM0未確定なら DATATYPES から除外(表と一致させる)。
  const DATATYPES = ["weight","body-fat","sleep","daily-resting-heart-rate",
                     "daily-heart-rate-variability","daily-oxygen-saturation","daily-vo2-max",
                     "daily-respiratory-rate","daily-skin-temperature","steps"];
  for (const type of DATATYPES) {
    const st = await getSyncRun(env.DB, type);            // sync_runs.data_type = GH dataType ID
    try {
      const since = st?.last_synced_at ?? daysAgo(14);
      // reconcile verb は discovery doc で確定済(§5.1)。cursor から再開。
      const { points, cursor } = await provider.reconcileDataPoints(type, since, now(), st?.last_cursor);
      // ★own-writeフィルタ(エコーループ防止, §5.4): 自分が push した手入力(weight/body-fat)を
      //   除外/紐付けのみにし、source='app' を 'google_health' で上書きしない。
      const external = points.filter(p => !isOwnWrite(env, type, p)); // gh_datapoint_id/dataSource/MANUAL照合
      await mergeIntoStore(env.DB, type, external);  // weight/body-fat は date キーで body_metrics 同一行へ合流
      await markOk(env.DB, type, now(), cursor);
    } catch (e) { await markError(env.DB, type, e); } // consecutive_failures++
  }
}
```
冪等性: `body_metrics/sleep_logs` は `UNIQUE(gh_external_id)`、`daily_metrics` は `PK(date,metric)` → 何度走っても同結果。日3回でも重複行が増えない。`mergeIntoStore` は dataType→格納先(§5.4マスタ表)で分岐し、`weight`+`body-fat` を同日 `body_metrics` 行へ upsert 合流する。

### 12.3 失敗時通知
`consecutive_failures >= 3`(特にrefresh失敗 `invalid_grant`=無人Workerの致命傷)で **Cloudflare Email Routing or Slack/Discord webhook** に1通だけ送る(dedupe)。`sync_runs` テーブル自体がUIダッシュボードになる(「最終同期2h前/体重OK/睡眠ERROR」)。

### 12.4 コスト(単一ユーザー)
| リソース | 想定 | 無料枠(確認日2026-05-31, 出典 cloudflare docs) | 判定 |
|---|---|---|---|
| Workers req | UI+MCP+cron(日3回+30分毎) → 数百〜数千/日 | 100,000/日 | ✅余裕 |
| D1 読み取り | 数千行/日 | 5,000,000/日 | ✅余裕 |
| D1 書き込み | 数百行/日 | 100,000/日 | ✅余裕 |
| **KV書き込み** | token refresh+cache+lock | **約1,000/日(変動しうる, 監視対象)** | ⚠️注意(§4.2対策で回避, 超過時は有料枠/D1移設) |
| KV読み取り | 参照 | 100,000/日 | ✅余裕 |

→ §4.2の対策を守れば**現行無料枠内で運用可能**(数値は変動しうるため断定でなく監視前提)。

### 12.5 D1 読み取りレプリケーション方針(レビュー minor への対応)
D1 読み取りレプリカは結果整合(レプリカ遅延〜数百ms、非保証)で、write 直後の read が古い値を返しうる。本構成は web/mcp 2Worker が同一D1共有 + 「全write一点経由・冪等」を謳うため整合に齟齬が出ないよう、**当面 D1 読み取りレプリケーションは無効(プライマリのみ)**とする(単一ユーザー・低QPSでレプリカの地理分散メリットは薄く、整合の単純さを優先)。将来有効化時は **Sessions API(withSession + bookmark)で write-after-read 整合**を取る。

---

## 13. ロードマップ(Fitbit→GH切替の9月期限)

```
[M0] 6月: モノレポ基盤 + コア層
  pnpm workspace/biome/vitest/wrangler構築, D1作成・マイグレーション(settings/targets/batch helper含む)
  HealthProvider抽象 + FitbitProvider移植 + Zod二層分離
  OAuth Pattern B→Google OAuth置換, 同意画面"In production"publish(7日失効回避), 両Worker共通getAccessToken+LOCK
  GoogleHealthProvider read実装 + intraday downsample + discovery docでreconcile verb確定/pin
  ★最優先ゲート(初日): OAuth Playgroundで nutrition.writeonly 取得→nutrition-log create を1発撃ち 200/403確認(§5.2,§14#1)
    → 403なら FEATURE_GH_NUTRITION_PUSH=false 据置・代替検討
  ★MVP前decide: ジムのプレートが kg/lb か確認し settings.unit_preference 主単位確定(§7.0,§14#11)
  ▸ 旧と同じreadが新コアで取れる

[M1] 7月: UI(PWA)MVP + 書き込み経路一本化
  Workout/Nutrition/BodyService実装(D1正本+batch原子性+GH push best-effort, idempotency+業務キー重複警告)
  UI: セットロガー(入力生値保存・中断再開)/食事フォーム(プリセット+手入力+オートコンプリート)/体重入力
      /種目→部位ヒートマップ(#7, weekly_target_sets目標基準)/kg-lb両表示(#8)/設定・目標編集
  差別化MVP: PR検知タイムライン + 体重/ボリューム/PFC単純トレンド
  Googleログインゲート, PWA manifest/SW/オフラインアウトボックス
  ▸ 7/15: Fitbitアカウント統合済み確認(未統合データ削除期限)

[M2] 7〜8月: 新MCP Worker + 並行運用 + 周径/写真の席
  apps/mcp構築, ツールD1経由再実装(§10.4確定IF: get_exercise_history等トレーナーAI中核read + log_meal_photo), secret一次+IP二次保護
  body_measurements(周径)有効化, 進捗写真R2の用途確定(任意)
  Claude.aiに新Custom Connector登録。旧/新MCP・UI並行運用, cron reconcileで整合監視

[M3] 8月: GH provider完全切替
  SyncService pullをGHに切替, write既定をGHに(Fitbit write停止)
  GH nutrition write 実grant最終確認 → 不能ならD1正本維持+push停止/代替dataType

[M4] 9月(Fitbit decommission前): 旧廃止 + 高度ビュー
  旧fitbit-googlehealth-mcp停止・Connector削除, FitbitProviderコアから削除
  差別化将来分: e1RM停滞検知/統合相関ビュー(周径軸含む)/オーバーリーチ警告
  UI直写真解析(Workers AI/Claude API)着手
  ▸ 単一スタック(GH+D1+UI+新MCP)で完全運用
```
**ロールバック余地**: M3までFitbitProvider残置 → GHのbreaking changeで詰まったら一時Fitbit readに戻せる(9月まで)。

---

## 14. 未決事項・リスク・要レビュー論点

| # | 項目 | 確度 | 暫定方針 / 検証アクション |
|---|---|---|---|
| 1 | **nutrition write が第三者クライアントに実grantされるか** | ✅**解決(2026-06-01)** 実トークンで `oauth:check` 実行 → `nutrition-log` create が **200 OK**(create→batchDelete 検証済)。当初の「主要価値が成立しない可能性」という根幹リスクは完全消滅 | `FEATURE_GH_NUTRITION_PUSH=true` 化。実フィールドは §17.5 で確定(foodDisplayName/energy{kcal}/totalCarbohydrate・totalFat/nutrients/interval start<end/ACTIVELY_MEASURED)。D1正本フォールバックは維持 |
| 2 | **identified vs anonymous food / Food カタログ供給源** | 【確定】anonymous immutable / 【要検証】Food ID解決・カタログ供給源 | anonymous food 固定で設計。「編集=delete+再create」前提。identified/Food検索は非目標(将来) |
| 3 | **筋トレ詳細の非保持** | 【確定: 2026-05-31時点】将来追加可能性あり | D1がSoT、GHはサマリ投影。スキーマ/マッパ疎結合で将来移行に備え |
| 4 | **reconcile HTTP verb** | ✅解決(2026-05-31 discovery doc + context7) | **reconcile = GET + query**(body無し)で確定。実装反映済。他のフィールドズレも併せ §17.4 で大量修正 |
| 5 | **GHレート制限数値** | 【要検証】公式未掲載 | 直列+指数バックオフ、cron予算は概算済(§12.2)、429観測後に調整。超過予兆でQueues採用 |
| 6 | **Google refreshのrotation / クロスWorker鮮度** | 【確定】Googleは毎回rotateせず同時refresh安全。要対策は別点 | クロスWorkerの access_token 鮮度: 両Worker共通 getAccessToken(失効60s前refresh+KV書戻し), LOCKで二重抑止・取得失敗側は再read。production publish必須 |
| 7 | **GH breaking change頻度** | 【確定】5/26にも変更 | Provider+DTO層分離、Zod契約テスト、discovery doc pin、CI日次smoke |
| 8 | **MealType写像(アプリ6種→GH実使用4値)** | 【確定】 | アプリ内6種保持、GH push時に Morning/Afternoon/Anytime→SNACK 縮退(GH enumはUNSPECIFIED含む5値, UNSPECIFIED未使用) |
| 9 | **アカウント統合期限** | ✅解決(2026-05-31 オーナー回答: 統合済み) | Fitbit→Google統合は完了済み。GH API OAuth経路はクリーン、7/15削除リスク無し |
| 10 | **過去Fitbitデータ移行** | 【要検証】GH遡及import可否不明 | 不可なら9月までFitbit+GH束ねて表示、以降GH。D1アーカイブ取り込み検討 |
| 11 | **ジムのプレートがkgかlbか** | ✅解決(2026-05-31 オーナー回答: 主にkg、マシンによりlbも有り) | `settings.unit_preference='kg'`(既定通り)。**両表示は既に常時併記+カード内トグル**(§9.3/§9.9)。lbマシンのセットは `workout_sets.entry_unit='lb'` で生値保存→**1セッション内でkg/lb混在を許容**(§7.0)。スキーマ変更不要 |
| 12 | **日本語種目名** | 要オーナー判断 | (a)頻用種目をLLMバッチ翻訳で`name_ja`補完(推奨) (b)wgerのCC-BY-SA訳は補助のみ |
| 13 | **体重手入力のGH書き戻し** | 確定(§2.1で一本化) | デバイス測定=GH read-only / 手入力=D1正本+best-effort writeonly push / 同日dedupeはデバイス優先 |
| 14 | **UI直接写真解析の主体** | 要判断 | MVPはMCP経由(Claude解析)で割り切り、UIは手入力+プリセット+オートコンプリートで完結。UI直解析はM4+ |
| 15 | **Cloudflare Access部分採用** | 要判断 | 自前OIDC推奨だが初速重視なら「`/`+`/api`だけAccess、`/mcp`対象外」も成立 |
| 16 | **GH側削除のミラー反映(soft-reconcile)** | 要判断 | MVPは追加・更新のみ反映、削除は手動で割り切り可。週次soft-reconcileは後付け |
| 17 | **Anthropic outbound IPレンジの変動/v6** | 【確定: 確認日2026-05-31】outbound IPv4 `160.79.104.0/21`(現行使用中)、v6は未明記 | 公式ページを唯一の真実とし設定外出し+定期確認。一次防御は secret。v6公表時は設定追加 |
| 18 | **D1原子性(batch)とGH push分離** | 【確定】D1はinteractive tx非対応 | 多表書込み/編集=delete+recreate は単一db.batch、派生は再計算、外部I/Oはbatch外best-effort、巨大セッションはbatch分割 |
| 19 | **二経路(UI/MCP)重複登録** | 要判断 | 業務キーの緩い重複警告をservices層に実装(自動マージはしない)。MCP新規authoring縮小も選択肢 |
| 20 | **D1読み取りレプリカ整合** | 【確定】レプリカは結果整合 | 当面プライマリのみ(レプリカ無効)。将来有効化はSessions API(withSession+bookmark) |
| 21 | **MCPに残す read の具体リスト**(コンシューマレビュー懸念1) | 確定(§10.4) | トレーナーAI中核read=get_exercise_history/get_personal_records/get_muscle_volume/get_training_frequency を UI と独立に保証。全read raw+計算済み両返し |
| 22 | **セット単位の荷重形態(自重/加重/アシスト)**(懸念2) | 確定(§7 workout_sets.load_mode / §8.1) | 符号規約でなく明示カラム `load_mode`。ディップス自重/加重ベルト/マシンアシストをセット毎に区別 |
| 23 | **読み取りのD1/provider境界**(懸念3) | 確定(§10.2) | 前日以前=D1確定 / 当日センシング=provider速報(provenance+as_of明示)。食事/ワークアウトは常にD1 |
| 24 | **e1RM計算の権限分担**(懸念4) | 確定(§8.2) | サーバー personal_records=確定値かつPR検知の正、AIは素データから補助計算可だが式はsettings.e1rm_formula既定・PR主張は台帳優先 |
| 25 | **片側/合計の重量規約**(懸念=同意点の未記載) | 確定(§7 exercises.load_basis / §8.1) | 入力生値は変換せず保存・表示、ボリュームのみ load_basis(total/per_limb/per_side)乗数で正規化。lateralityと二重適用しない |
| 26 | **RPEレスセットのe1RM/PR精度**(懸念5) | 将来メモ(§8.2) | RPEレス=e1RM参考値、PR確定はRPE付き/AMRAP/failure優先、暫定PRフラグ。停滞検知(M4)で活用。MVPは参考値含め検知しフラグ区別 |

---

## 15. 要件カバレッジ表

| # | 要件 | 対応箇所 | 充足状況 |
|---|---|---|---|
| 1 | D1等Cloudflareスタックで公開 | §4(Workers/D1/KV/Cron), §12(wrangler/デプロイ/cron予算/レプリカ方針) | ✅ 完全対応 |
| 2 | Google authで認証 | §6.1(系統A: Google OIDCログインゲート) | ✅ 完全対応 |
| 3 | 完全に自分用(ユーザー1名) | §6.1(email+sub allowlist), §11(マルチテナント非目標), §1.3 | ✅ 完全対応 |
| 4 | 登録/削除/編集を優れたUIで | §9.3-9.7(セットロガー/中断再開/食事/スワイプ編集削除/Optimistic UI), §7(CRUD用テーブル+settings/targets), §8.5(編集の原子性) | ✅ 完全対応 |
| 5 | PWA スマホ最適化 | §9.1(下部タブ), §9.8(manifest/SW/オフライン下書き/インストール導線) | ✅ 完全対応 |
| 6 | 既存MCP互換は軽視、GH API最新は重要 | §5(GH最新制約・確定/要検証ラベル統一・nutrition write格下げ・reconcile確定方針), §10(既存repo移行) | ✅ 対応(nutrition push は §14#1 のM0実測ゲート待ち・flag OFF既定で出荷可、D1正本でフォールバック済。read/exercise/weight write は確定) |
| 7 | 種目→部位プリセット + 人体ヒートマップ | §7(exercise_muscles PK修正/muscle_groups.weekly_target_sets), §8.3(stimulus集計・二重計上防止・目標基準), §9.5(図鑑+ヒートマップ), §9.10(body-highlighter/free-exercise-db) | ✅ 完全対応 |
| 8 | 重さkg/lb両表示 | §7.0/§9.9(入力生値+単位正本でドリフト回避/両併記), §7(entry_value/entry_unit), §1施工前decide(§14#11) | ✅ 完全対応 |

---

## 16. 出典

**Google Health API v4 / Fitbit**
- https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints
- https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
- https://developers.google.com/health/reference/rpc/google.devicesandservices.health.v4
- https://developers.google.com/health/data-types / /scopes / /setup / /endpoints / /release-notes / /about / /migration
- https://developers.google.com/identity/protocols/oauth2/policies
- https://developer.android.com/health-and-fitness/health-connect/data-types
- https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api
- https://community.fitbit.com/t5/Web-API-Development/Introducing-the-next-phase-of-the-Fitbit-Web-API/td-p/5821061
- https://www.thryve.health/blog/fitbit-api-deprecation

**Cloudflare / Anthropic**
- https://developers.cloudflare.com/workers/static-assets/ (binding / migration-guides/migrate-from-pages)
- https://developers.cloudflare.com/d1/platform/limits/ / /pricing/ / best-practices/ (transactions=batchのみ) / read-replication/ (Sessions API)
- https://developers.cloudflare.com/kv/platform/pricing/ / limits/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/ / examples/multiple-cron-triggers/ / runtime-apis/handlers/scheduled/ / platform/limits/ (subrequests)
- https://developers.cloudflare.com/agents/guides/remote-mcp-server/ / model-context-protocol/transport/
- https://jsr.io/@hono/mcp
- https://developers.cloudflare.com/workers/vite-plugin/tutorial/ / framework-guides/web-apps/react/
- https://support.google.com/cloud/answer/15549945
- https://platform.claude.com/docs/en/api/ip-addresses (確認日2026-05-31: outbound IPv4 160.79.104.0/21, inbound 160.79.104.0/23 + 2607:6bc0::/48, 34.162.x.x/32群は廃止)

**PWA / UI / データセット**
- https://github.com/lahaxearnaud/body-highlighter (MIT, framework-agnostic)
- https://github.com/HichamELBSI/react-native-body-highlighter (MIT, 2026-04)
- https://github.com/yuhonas/free-exercise-db (Public Domain, 800+種目)
- https://github.com/wger-project/wger (AGPL-3.0 / データCC-BY-SA)
- https://github.com/vite-pwa/vite-plugin-pwa / https://vite-pwa-org.netlify.app/
- https://blog.logrocket.com/best-react-chart-libraries-2025/

---

## 17. レビュー反映サマリ(改訂で対応した指摘)

### 17.1 初版 批判レビュー反映(v1→v2基盤)

| 指摘(重大度) | 対応 |
|---|---|
| Anthropic CIDR (critical) | §6.3/§11/§3/§14#17 で正確化。公式再確認の結果、現行 outbound は `160.79.104.0/21`(使用中)で、廃止は `34.162.x.x/32` 群(レビューの inbound/outbound 取り違えを是正)。ハードコード回避・secret一次防御・公式追従・v6パース準備を明記 |
| nutrition write 確度矛盾 (major) | §0/§5.2/§14#1 で【要検証・最重要】に統一格下げ。feature flag化、M0最優先ゲート、403フォールバック本文化 |
| D1原子性 (major) | §8.5/§14#18 で単一db.batch・派生再計算・外部I/Oのbatch外best-effort・巨大セッションbatch分割を明記 |
| cron予算/再入 (major) | §12.2/§14#5 でサブリクエスト概算・pull/push別スロット・last_cursor再入・Queues代替を明記 |
| 二経路重複 (major) | §8.7/§10.2/§14#19 で業務キー重複警告・MCP新規authoring縮小案 |
| exercise_muscles PKバグ (major) | §7 で PK=(exercise_id, muscle_group_id) に修正、二重計上不可・dedupe明記 |
| settings/targets欠落 (major) | §7 に settings / nutrition_targets / muscle_groups.weekly_target_sets 追加 |
| 重量ドリフト (major) | §7.0/§9.9 で entry_value+entry_unit 正本化、MVP前 decide に格上げ |
| 中断セッション再開 (major) | §9.3/§9.2 に in_progress 検出バナー・stale化 |
| 周径/進捗写真欠落 (major) | §1.4/§7(body_measurements)/§13 M2 に将来拡張として明示 |
| 食事編集の波及 (minor) | §8.5/§9.7 で D1同一id UPDATE + GH datapoint差し替えを明記 |
| UI完結性ギャップ (minor) | §9.4 で MVPは手入力+プリセット完結・写真はMCP経由制約・オートコンプリート追加 |
| §8.6差別化のロードマップ未割当 (minor) | §8.6/§13 で MVP(M1)と将来(M4)に分割 |
| 体重書き戻し3箇所矛盾 (minor) | §2.1 に単一方針へ統一、§9.2/§9.7/§14#13 整合 |
| ヒートマップ目標値の格納先欠落 (minor) | §7 muscle_groups.weekly_target_sets / §8.3 |
| D1読みレプリカ整合 (minor) | §12.5/§14#20 でプライマリのみ・将来Sessions API |
| クロスWorkerトークン鮮度 (minor) | §6.2/§14#6 で懸念の方向修正+共通getAccessToken |
| reconcile verb未確定 (minor) | §5.1/§14#4 でM0 discovery doc確定・pin |
| identified/anonymous食 (minor) | §5.2 で anonymous固定・patch不可分岐・Food検索を将来#へ |
| KV無料枠断定 (minor) | §4.2/§12.4 で確認日付・変動前提・超過時対応に緩和 |
| exercise詳細非保持の確度過剰 (minor) | §5.3/§14#3 で時点明示+将来移行の備え |

### 17.2 コンシューマ(トレーナーAI=MCP利用側)レビュー反映 — v2改訂
普段使いのClaudeアプリにMCPコンシューマ視点でレビューさせた結果を反映。5指摘とも実装前に効く良指摘で、メカニズムを一部洗練して採用。

| 指摘 | 対応 |
|---|---|
| 1. get_exercise_history 等、**MCPに残すreadの具体名が無い**(§10.2が量の話に留まる) | §10.4 を新設し**確定インターフェース**を定義。トレーナーAI中核read(種目軸時系列/PR/部位別ボリューム/頻度)を UI と独立に保証。全read raw+計算済み両返し |
| 2. workout_sets に**自重/加重/アシストのセット単位区別が無い** | §7 に `load_mode`(明示カラム。符号規約は不採用)、§8.1 に自重/加重/アシストの load_kg 計算 |
| 3. D1一次+providerフォールバックの**境界が曖昧で数字の一貫性が崩れうる** | §10.2 で「前日以前=D1確定 / 当日=provider速報(provenance+as_of)」と確定 |
| 4. e1RMが**サーバーとAIで二重計算**、どちらが正か未定 | §8.2 で権限分担明記(台帳=確定値・PR検知の正、AIは補助計算可・式合わせ既定) |
| 5. **RPEレスセットのe1RM精度**の帰結が未整理 | §8.2 に将来ルール(参考値扱い・PR確定はRPE/AMRAP/failure優先・暫定PRフラグ) |
| 同意点だが**片側/合計マシンの規約が未記載** | §7 `exercises.load_basis` + §8.1 乗数。入力生値は保ち、ボリュームのみ正規化(表示の素直さと集計の一貫性を両立) |

**判断メモ**: 懸念2は「entry_valueの符号(±)で加重/アシスト表現」案が出たが、符号は事故源(負値の取り違え・NULL混在)になりやすいため**明示カラム `load_mode` に洗練して採用**。片側規約は「全部合計に正規化」案より、**入力生値を保ったまま load_basis 乗数で正規化**する方が §7.0(生値正本)と一貫し表示も素直なので、そちらを採用しつつコンシューマには raw+正規化の両方を返して算術負担を消した。

**内部検証ラウンド(v2の自己レビュー)**: v2改訂後に2レンズ(内部整合/コンシューマ実効カバレッジ)で敵対的検証を実施し、3件を追加修正 — ① `get_personal_records` が `is_provisional`/`pr_basis` を返さず確定/暫定PRをAIが区別不能だった不整合(§10.4/§8.2で修正、懸念4・5の実効を担保)② AI向けの種目名→id解決・列挙手段の欠落(§10.4 `search_exercises` 追加+名前解決規約)③ `provenance` enum の未定義(`d1_confirmed|gh_provisional` を明示)。

### 17.3 実装前 最終監査(v3改訂) — 4面の独立通読
実装着手の直前に、設計書全文を4レンズ(相互参照整合 / スキーマ↔ロジック↔UI↔MCP / SoT・同期整合 / 実装readiness)で独立監査。**blocker2・major8・minor7・nit2 を検出し全件反映**。要点:

| 種別 | 指摘(検出レンズ) | 対応 |
|---|---|---|
| blocker | **体重/体脂肪の手入力pushが daily reconcile で再取込される echoループ**(§2.1 dedupeが手入力をデバイス測定と誤認し read-only降格) | §5.4/§12.2 に **own-writeフィルタ**を明文化(gh_datapoint_id/dataSource/MANUAL照合で自分の書込みを除外・紐付けのみ、source上書き禁止) |
| blocker/major | **§5.4読取dataType表 ⇔ §12.2ループ ⇔ daily_metrics ⇔ §2 SoT表の不整合**(resp_rate/skin_tempにdataType無し・steps取りこぼし・body_metricsの2dataType分解未定義・内部名→GH dataType ID写像未定義)— **全4レンズが独立検出** | §5.4を**単一マスタ表**(内部キー↔GH dataType ID↔scope↔格納先)に再構成、§12.2ループ/daily_metrics enum/§2表を全部それに整合。weight+body-fatの日付合流、vo2max、resp/skin/stepsの扱いを明記 |
| major | **`pr_basis` 列が DDL に欠落**(§10.4/§8.2が「必ず返す」と明言したのに格納先なし)— 2レンズ検出 | `personal_records.pr_basis` 追加+派生再計算で永続化 |
| major | **集計単位の矛盾**(§7.0/§9.9「同一単位系で算術」⇔§8.1 kg正規化、kg/lb混在で破綻) | §7.0/§9.9を「生値は保存・**集計は§8.1 load_kgでkg正規化**」に修正、§8.1を集計の単一の正に |
| major | **PRの単位規約未定義**(weight_at_reps等、混在でPR検知不能) | §8.2に「全PRはkg正規化値・unit='kg'固定、max_reps_at_weightは±0.5kg許容で同値」 |
| minor | meals.source の既定値とコメント矛盾 / weight_kg の意味曖昧 / 正規化値の単位ラベル無し / FK前方参照の注記無し / 当日体重速報と二系統の整合 / token refresh cron表記 / migration命名規約 | それぞれ §7(input_method改名・weight_kgコメント・FK注記・migration規約)、§10.4(kg固定明示)、§10.2(体重二系統)、§4.2(lazy refresh)で修正 |
| nit | MealType表記ブレ / §15#6カバレッジ誇張 | §5.2/§14#8 用語統一、§15#6を条件付き表記に |

**監査の総意**: データ破損に至る blocker は echoループ1件のみ(フィルタ追記で解消)、設計の骨格(二層SoT・kg正準・Provider抽象・batch原子性)は健全で、上記反映後は **実装着手可**。

### 17.4 discovery doc pin 適用(M0実装中, 2026-05-31)
GH v4 の**公開 discovery doc**(`https://health.googleapis.com/$discovery/rest?version=v4`, トークン不要)+ context7 クロスチェックで、実装の GH read/write フィールドを **トークン取得前に** pin。設計時 best-effort だった `mappers.ts` に15件のズレが見つかり全件修正(`packages/core/src/providers/google-health/`)。確定した正(authoritative):

| 項目 | 設計時の想定 | 確定(discovery doc) |
|---|---|---|
| reconcile verb | POST + body | **GET + query**(pageSize/pageToken/filter) |
| 値の位置 | DataPoint 直下 `value`/`dailyValue` | **typed sub-object 配下**(`weight`/`bodyFat`/`steps`/`sleep`/`dailyRestingHeartRate`/`dailyHeartRateVariability`/`dailyOxygenSaturation`/`dailyVo2Max`) |
| 体重 | `kilograms` | **`weight.weightGrams`**(double, kg×1000) |
| 体脂肪 | `bodyFat.percentage` | 同左 ✅ |
| exercise | `exerciseMetadata.{displayName,activeDuration,notes}` ネスト | **top-level** `displayName`/`activeDuration`/`notes`、calories=`metricsSummary.caloriesKcal` |
| nutrition | `foodDisplayName` / `energy.kcal` | **`nutritionLog.foodDisplayName`** / `energy{kcal}` / `totalCarbohydrate`・`totalFat{grams}` / `nutrients[]{nutrient(enum),quantity:{grams}}` / `mealType` ※§17.5で実機確定 |
| daily 値 | `value` | resting=`beatsPerMinute` / hrv=`averageHeartRateVariabilityMilliseconds` / spo2=`averagePercentage` / vo2max=`vo2MaxMlPerKgPerMinute` / resp=`breathsPerMinute` ※§17.5で実機確定 |
| int64(steps.count, beatsPerMinute) | number | **JSON 文字列**で返る → 文字列も数値化して受理 |
| daily 時刻 | RFC3339 文字列 | 構造化 **`Date{year,month,day}`**(weight/bodyFatは`sampleTime.physicalTime`, steps/sleepは`interval.startTime`) |
| sleep | `sleep.totalDurationMinutes` 等 | **`sleep.summary.minutesAsleep`** + `summary.stagesSummary[]{type,minutes}`、efficiency は導出(minutesAsleep/minutesInSleepPeriod) ※§17.5で実機確定 |
| recordingMethod | `MANUAL` | enum に MANUAL 無し → **`ACTIVELY_MEASURED`**(§17.5で ACTIVELY_RECORDED が 400 と判明し訂正)。own-write 判定は `gh_datapoint_id` 一致を主に(recordingMethod非依存) |
| create 応答 | bare DataPoint | **Operation**(`response.name` 優先、直下 name フォールバック) |

### 17.5 実トークン契約テスト確定(接続フェーズ, 2026-06-01)
オーナーの実 OAuth トークンで `gh:probe`(read reconcile)/`oauth:check`(nutrition create→batchDelete)を実行し、§17.4 の discovery pin を**実レスポンスで最終照合**。判明したズレを全件訂正(`mappers.ts`/`discovery-pin.ts`):

| 種別 | 実機で判明 | 訂正 |
|---|---|---|
| read filter 文法 | `start_time` 直・`<=` は `INVALID_DATA_POINT_FILTER` | 値オブジェクト名プレフィックス付き(`weight.sample_time.physical_time`/`daily_*.date`)+ 演算子 `>=`/`<` のみ。`buildReadFilter` 化 |
| sleep filter | `sleep.interval.start_time` は member 不可(400) | **`sleep.interval.end_time`** のみ有効(`intervalTimeField`) |
| sleep stages | `sleep.stagesSummary` | **`sleep.summary.stagesSummary`**(StageSummary{type,minutes(int64文字列),count}) |
| spo2 | `percentage` | **`averagePercentage`** |
| respiratory | (case 無し→null) | **`breathsPerMinute`** + date 抽出 case 追加 |
| reconcile 応答形 | (data ラッパー想定) | 値は **DataPoint 直下**(weight/body-fat/steps は `dataPointName` 付、daily は無)。data ラッパーは防御的後方互換 |
| nutrition フィールド | `foodName`/`caloriesKcal`(discovery agent の誤推定) | **`foodDisplayName`/`energy{kcal}`**。炭水・脂質は top-level `totalCarbohydrate`/`totalFat`(WeightQuantity{grams})。nutrients は `{nutrient(enum),quantity:{grams}}` で PROTEIN/DIETARY_FIBER/SUGAR/SODIUM のみ(**TOTAL_FAT/CARBOHYDRATES は enum 非対応**) |
| nutrition interval | start==end | **start<end 必須**(同時刻は 400)→ 終端 +60s |
| recordingMethod | `ACTIVELY_RECORDED` | **`ACTIVELY_MEASURED`**(前者は 400) |

**確定した接続**: read = weight / body-fat / sleep / daily-resting-heart-rate / daily-heart-rate-variability / daily-oxygen-saturation / daily-respiratory-rate / steps(実データで値・時刻一致を確認)。write = exercise / **nutrition(200 OK, create→batchDelete 検証済)** / weight / body-fat。これにより §14#1 の「nutrition write が成立しない可能性」リスクは**実機 200 で完全解消**、`FEATURE_GH_NUTRITION_PUSH=true` 化。

**残 openItem**(D1 正本に影響せず): ① **VO2max** — 実データが空(reconcile 0 件)。dataType ID・フィールドは pin 済、データ発生後に値確認 ② **skin-temp** — `tools/probe-datatypes` で候補8種(daily-skin-temperature / skin-temperature / wrist-temperature / body-temperature 等)すべて `Invalid data type ID` と確定 → **GH はこのクライアントに皮膚温を提供していない**。恒久除外。 ③ **steps** — daily-steps/daily-step-count/step-count も全て Invalid。歩数は `steps`(分単位 interval)のみ。日次合計は時刻ゲートで日数回 interval 集計→overwrite する後続実装で復帰(§5.4)。

**own-write echo と recordingMethod の整理(2026-06-01)**: pull 対象(weight/body-fat/sleep/daily-*)と push 対象(exercise/nutrition-log/weight/body-fat)のうち **重複するのは weight/body-fat のみ**。手入力体組成 push は現状 UI 導線が無い(体重は GH 取込が主)が、`logWeight`→`pushBodyMetric` 経路は存在する。echo 防止は **`gh_datapoint_id` 一致による own-write 判定**(`isKnownOwnWrite`)で行い、`recordingMethod` には依存しない。よって §2.1 の「手入力=MANUAL」記述は実装と不一致(MANUAL は GH enum に無く 400、実装は全 push で `ACTIVELY_MEASURED`)→ **own-write 判定は recordingMethod 非依存なので機能上の問題なし**。設計記述を実装に合わせて訂正(MANUAL → ACTIVELY_MEASURED, 判定は gh_datapoint_id)。

**同期ヘルスの可視化(2026-06-01)**: KV TTL バグで pull が全滅しても気づけなかった反省から、`gh:auth_error`(invalid_grant 記録)+ `GET /api/sync-status` + Home の警告バナーを追加。再認証要・連続失敗を必ず UI に出す。

**意義**: 「要検証(discovery pin)」とマークしていた最大の実装リスク(特に nutrition write 可否)を**実トークンで完全解消**。GH 連携は read/write 全 dataType が実データで確定。vitest 39 tests で int64文字列/Date型時刻/weightGrams/sleep summary/nutrition payload/interval を回帰固定。

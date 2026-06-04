# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Logbook — 単一ユーザー(オーナー本人)向けボディメイク記録 PWA + トレーナーAI(MCP)。Cloudflare Workers + D1 + KV。
> 全体設計は `docs/design.md`、MCP は `docs/mcp-design.md`、GH API は `docs/gh-datatypes.md` / `docs/research-appendix.md`。

## コマンド

pnpm 9.1.1 / Node >=20 のモノレポ。基本はリポジトリ root から `--filter` で叩く。

```bash
pnpm install

# 開発(SPA + /api 同居。http://localhost:5173)。.dev.vars の DEV_AUTH_BYPASS=1 でログイン不要。
pnpm --filter @ghs/web dev
pnpm --filter @ghs/mcp dev          # MCP サーバ(wrangler dev)。dev は secret/IP チェック無効。

# 型チェック(core/web/mcp/tools 全部)。web だけは worker と app の2 tsconfig を順に走らせる。
pnpm typecheck
pnpm --filter @ghs/web typecheck    # tsc -p tsconfig.worker.json && tsc -p tsconfig.app.json

# テスト(vitest。core / web / mcp の各 package が持つ。大半は core のドメイン/mapper)
pnpm test                                               # 全 package(pnpm -r --if-present test)
pnpm --filter @ghs/core test                            # core(ドメイン計算・GH mapper・services 統合)
pnpm --filter @ghs/web  test                            # web(UI lib。vitest.config.ts 指定)
pnpm --filter @ghs/mcp  test                            # mcp(auth ヘルパー timingSafeEqual/ipv4InCidr など)
pnpm --filter @ghs/core test -- src/util/date.test.ts   # 単一ファイル
pnpm --filter @ghs/core test -- -t "e1rm"               # 名前で絞る

# Lint / Format(Biome)
pnpm lint        # biome check .
pnpm format      # biome format --write .

# D1 マイグレーション(SQL は packages/core/src/db/migrations/。web の wrangler.jsonc だけが migrations_dir を持つ)
pnpm db:apply:local
pnpm db:apply:remote

# デプロイ(web と mcp は別 Worker。それぞれ個別にデプロイ)
pnpm --filter @ghs/web run deploy   # ★ run 必須。省くと pnpm 組み込みの deploy が走る。中身は vite build && wrangler deploy
pnpm --filter @ghs/mcp run deploy
#   ※ deploy はマイグレーションを実行しない。スキーマ変更時は db:apply:remote を別途必ず実行する。

# GH(Google Health)OAuth / 実データ検証ツール(ローカルのみ。.dev.vars の GOOGLE_CLIENT_ID/SECRET 必要)
pnpm --filter @ghs/tools oauth:bootstrap   # 初回トークン取得(redirect_uri は http://127.0.0.1:8788/oauth/callback)
pnpm --filter @ghs/tools oauth:check       # nutrition.writeonly grant の 200/403 確認
pnpm --filter @ghs/tools gh:probe          # read mapper を実データで検証

# バインディング型の再生成(wrangler.jsonc を変えたら)
pnpm --filter @ghs/web cf-typegen
```

## アーキテクチャ(複数ファイルを跨ぐ全体像)

### モノレポ構成と依存方向

- **`packages/core`(`@ghs/core`)** — ドメイン / DB / services / providers / auth。**全ビジネスロジックの本体**。`apps/*` から `workspace:*` で参照。サブパス import 可(`@ghs/core/util/date` 等、`exports` map 定義)。
- **`apps/web`(`@ghs/web`)** — React 19 SPA + Hono の `/api` Worker を **1つの `@cloudflare/vite-plugin` プロジェクトに同居**。cron(`*/5`)もここ。
- **`apps/mcp`(`@ghs/mcp`)** — トレーナーAI(claude.ai)向け MCP サーバ。**`apps/mcp/src/index.ts` 単一ファイル**に全ツール。
- **`tools`(`@ghs/tools`)** — OAuth bootstrap / GH probe など tsx CLI。

### 2層のデータモデル(これを取り違えると全部間違える)

**D1 が唯一の正本**。流れは2系統:

1. **authoring(app/MCP → D1 → GH)**: 食事・ワークアウト・体重は UI と MCP の両方から書け、保存と同時に GH へ **best-effort で一方向 push**。**GH からは pull しない**(二重取込防止)。
2. **sensing(GH デバイス → D1, read-only)**: 睡眠・安静時心拍・HRV・SpO₂・VO₂max・呼吸数・歩数・消費kcal は GH が真実で、cron が pull して表示。

種別ごとの正確な流れは `README.md` の表が一次情報。皮膚温は GH 未提供で恒久除外。

### 単一書き込みパス(最重要規約)

**全ての書き込みは `packages/core/src/services/*` を必ず経由する**(`logMeal` / `saveWorkout` / `logWeight` / `saveRoutine` ほか)。UI の `/api` も MCP も同じ service 関数を呼ぶので両者が自動的に揃う。`apps/*` 内で生 SQL / `db.run` を直接書かない。

- D1 は**インタラクティブ TX 非対応**。原子性は**単一 `db.batch()` の中だけ**保証される。複数テーブル書き込み(session+exercises+sets、meal+items、+ `gh_sync_state` エントリ)は `runBatch(db, Stmt[])` に集約する(`packages/core/src/db/batch-helpers.ts` の `stmt`/`insertStmt`/`upsertStmt`/`deleteByStmt`)。ループで `db.run` を回さない。
- **冪等性は `client_request_id`**。`meals` / `workout_sessions` に保存し、core が同 ID を SELECT-dedup する。**呼び出し側(web/MCP)が ID を生成・再送時に再利用する責務**。生成しないと再送で二重記録になる(footgun)。`log_weight` には現状 crid が無く、MCP 側 soft-guard(同日近接重複の確認)で防いでいる。
- 値は内部的に **kg / kcal / g に正規化**して保存・集計(sodium のみ mg)。入力単位(kg/lb 等)は `entry_value`/`entry_unit` で別途保持。日付は **JST の `YYYY-MM-DD` 文字列**、timestamp は **Unix 秒**。GH API 境界だけ millis なので ×1000(off-by-1000 はサイレントなデータ欠損)。

### GH push の状態機械(`gh_sync_state`)

push は失敗しても D1 には残る(best-effort)。`gh_sync_state` 台帳が `pending → synced / failed → dead_letter` を追跡。

- 通常は記録時 inline 送信。cron はあくまで失敗再送の保険(最大 20 件/回、指数バックオフ、`PUSH_MAX_RETRIES` 超で dead_letter)。403/401/400 は**恒久失敗**。
- 食事の GH push は **`FEATURE_GH_NUTRITION_PUSH`**(本番 `true`)が ON のときだけ。OFF なら D1 には入るが `skipped_flag_off` で記録され push されず、**後でフラグを ON にしても自動再送はされない**。
- pull 時は **自分の push 由来を `gh_external_id` / `gh_data_origin` で除外**してエコーループを防ぐ。pull の since 窓は last_synced_at から **3日遡る**(Fitbit→GH ミラーの遅延到着を拾うため)。

### cron パイプライン(`apps/web/src/index.ts` `scheduled`)

単一 cron 式 `*/5`(account の cron 枠5本制限のため1式に集約)。各段は **`.catch` で独立に隔離**(前段の throw で push 再送がスキップされないように)、失敗は握りつぶさず `console.error`(observability 有効 → `wrangler tail` / dashboard で点検):

1. `staleAbandonedSessions` — 放置 `in_progress` を `stale` 化
2. `runDailyPull` — sensing を D1 へ取込(own-write 除外・冪等)
3. `pullStepsDaily` / `pullActiveEnergyDaily` — 分単位 interval を日次合算(毎回。JST 07時のみ3日分再集計)
4. `retryPendingPushes` — 失敗/未送 push を再送

時刻ゲートは `controller.scheduledTime`(Cloudflare 発行 UTC)を JST 変換して判定する。`Date.now()` は使わない。

### 認証(2系統)

- **系統A(web ログイン)**: Google OIDC → ID token 検証 → HS256 セッション JWT(HttpOnly Cookie, 30日)。`/api/*` は `requireAuth` ゲート背後で `ALLOWED_EMAIL`(任意で `ALLOWED_SUB`)を照合。**`DEV_AUTH_BYPASS=1` は `.dev.vars` かつ localhost からのみ有効**(本番ドメインでは効かない二重ガード)。
- **系統B(GH API)**: Google OAuth Pattern B。refresh token を KV に保持し、expiry 60秒手前で遅延 refresh(KV LOCK で二重 refresh 抑制)。`tokenStore.ts` / `googleOAuth.ts`。

### MCP サーバ(`apps/mcp/src/index.ts`)

- Hono + `@hono/mcp` の `StreamableHTTPTransport`。**ステートレス**(リクエスト毎に `McpServer` 生成)。`server.registerTool(...)` を **31本**(記録→分析→週次サマリ→コンディション→ルーティン→栄養/エネルギー/食事スコア→ワークアウトメモ→GH反映→取消)。`buildServer` は機能群の register 関数(read/write/destructive/routine)に分解し `index.test.ts` の contract で登録集合を回帰ガード。catalog の説明は `docs/mcp-design.md`。
- web と**同一の D1 / KV(TOKENS/LOCK/CACHE)を共有**。`migrations_dir` も cron も assets も持たない(スキーマの正本は web)。
- 全 write ツールは `makeContext(env)` → core service を呼ぶ薄いラッパ。生 SQL は書かない。返り値は必ず `ghPushed` / `ghDeleted`(GH 反映の真偽)を含める — **嘘をつくと Claude がデータ可視性を失う**。
- 認証は2層: 一次 = `MCP_SHARED_SECRET`(URL 埋め込み, fail-closed, 定数時間比較)、二次 = Anthropic 送信元 IP allowlist `ANTHROPIC_OUTBOUND_CIDR`(=`160.79.104.0/21`, fail-open)。比較ヘルパー `timingSafeEqual`/`ipv4InCidr` は `apps/mcp/src/auth.ts`(`auth.test.ts` でテスト)。
- 種目は単一文字列を `resolveExerciseId()` で解決(完全 ID → 完全名 → 部分検索)。曖昧なら throw せず `{ candidates }` を返す。日本語俗称・略称・マシン名は `exercise_aliases`(migration 0012/0013/0015)で吸収。`name_ja` は必須(全種目に日本語名があり、**UI は `name_ja` を主表示**)。

### ドメイン計算(`packages/core/src/domain/`)

純粋関数群(`metrics.ts` の load_kg / set_volume_kg / e1rm、`training-progress.ts` の MEV/MAV/MRV・停滞検知、`readiness.ts`、`nutrition-recovery.ts`、`nutrition-score.ts` の食事スコア(台形バンド+加重幾何平均)、`routine.ts`)。DB を触らず、services / UI が read-only rollup に使う。筋部位は固定16群。

- **筋ボリュームには非互換な2つの集計基準がある(混同禁止)**: ①**主働のみ**(`get_training_frequency` / `get_muscle_calendar` = どの日にどの部位を叩いたか)、②**間接含む**(`get_muscle_volume` / `get_readiness.muscleLoad` = 二次・スタビライザの貢献度 primary 1.0 / secondary 0.5 / stabilizer 0.25 込みで刺激が足りているか)。
- ウォームアップセットは intensity 系集計から除外(`countsTowardVolume()`)。

## コード規約

- **Biome**: シングルクォート / セミコロン必須 / trailing comma all / 2スペース / 行幅100。`useImportType` error(`import type` を使う)、`noNonNullAssertion` off、`noExplicitAny` warn(test では off)。
- **TS strict**(`tsconfig.base.json`): `noUncheckedIndexedAccess` / `noImplicitOverride` / `noUnusedLocals` / `noUnusedParameters` / `verbatimModuleSyntax` / `isolatedModules` 有効。
- ID は ULID(時系列ソート可)、SQLite boolean は 0/1。
- 機能を出荷したら **ドキュメント(`docs/design.md` / `docs/mcp-design.md` / `docs/enhancements.md`)の最新化を必ず同梱する**(選択肢にしない)。

## docs マップ

| ファイル | 内容 |
|---|---|
| `design.md` | マスター設計(全体像・コア決定・GH 制約・スキーマ戦略)。まずここ |
| `mcp-design.md` | MCP サーバ設計の正本(ツール catalog・認証・write 検証・echo+confirm) |
| `gh-datatypes.md` | GH v4 dataType の権威カタログ(ID を推測せずここを参照) |
| `deploy.md` | 接続・デプロイ手順(GCP OAuth → bootstrap → check → probe → Cloud) |
| `remaining-tasks.md` / `work-plan.md` | バックログ・進行中スプリント |
| `enhancements.md` | 機能拡張アイデア(MCP-first レンズで選別)。§18=データ拡張ロードマップ |
| `nutrition-scoring-design.md` | 食事スコアリング設計(マクロ目標適合度の採点・レーダー。実装済) |
| `research-appendix.md` | GH API / 既存アプリの深掘り調査 |
| `ux-review.md` / `review-findings.md` | UI 評価 / 6観点レビュー結果 |
| `mcp-review-packet*.md` | MCP 認証方式の事前レビュー(secret+IP を採用した経緯) |

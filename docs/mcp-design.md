# Logbook MCP 設計 — 正典(Single Source of Truth for `apps/mcp`)

> 本書は Logbook の MCP サーバ(`apps/mcp` / `@ghs/mcp`)の唯一の正典設計である。3つの設計案と2名の審査を統合し、プロジェクトの SoT である `docs/design.md`(特に §3 / §6.3 / §10.2 / §10.4 / §11 / §13)と完全整合させた。`apps/mcp` 等のソース/設定コードは本書では作成しない(本書 1 ファイルのみ)。実装は M2 で着手する(`docs/design.md` §13)。
>
> 関連: `docs/design.md`(全体設計)、`packages/core/src/domain/inputs.ts`(Zod 入力)、`packages/core/src/services/*`(write 一点経由 §8.5)、`apps/web/src/api/routes.ts`(同型のラッパ参照実装)、`apps/web/wrangler.jsonc`(共有 D1/KV の ID)。

---

## 0. 統合判断のサマリ(なぜこの設計か)

採用ベース: **案2(minimal lens)を骨格に、案3(safety レンズ)の安全作り込みを Durable Object 抜きで全面取り込み、案1(claude-first)の充実ツールカタログを §10.4 確定セットに絞って参照する。**

判断理由(必ず根拠を添える):

1. **認証は OAuth ではなく `MCP_SHARED_SECRET` を採用する。** 3案はいずれも「claude.ai Web は OAuth が唯一の完全サポート方式」を根拠に OAuth(`@cloudflare/workers-oauth-provider` + Google upstream + email ゲート)へ倒した。**だがこれは SoT の確定決定に反する。** `docs/design.md` §6.3(「6.3 MCP保護【確定・踏襲 + IP値修正】」)/§11(`docs/design.md:935`)は **「一次防御 = URL埋め込み `MCP_SHARED_SECRET`(fail-closed)+ 二次防御 = Anthropic outbound IP allowlist(`160.79.104.0/21`)、claude.ai には OAuthなし Custom Connector 登録」をセキュリティレビュー済みで確定**している。第1審査が指摘したとおり、3案の「Web は secret 不可」という前提は **静的 Bearer ヘッダ(claude.ai Web の連携 UI に欄が無く非対応)と URL埋め込み secret(Custom Connector の URL にクエリ/パスとして埋め込め、対応)の混同**である。確定済み決定を無言で覆すのは設計書との不整合を生むため、本書は SoT を踏襲する。OAuth は「将来 identity/UX 上の利得が新規コスト(OAUTH_KV・DCR 蓄積・GCP redirect_uri 追加登録・props 暗号配線)を上回ると明示判断できた場合」の代替経路として §4.7 に保留する。

2. **Durable Object は採用しない。** `docs/design.md:159` が「Durable Objects | 不採用 | — | 単一ユーザーで強整合並行調停の価値が無い」と明記。案1/案3 の `McpAgent` + DO は SoT に正面衝突する。冪等は core が既に `client_request_id` の SELECT-dedup を持つ(`nutrition.ts:51-57` / `workout.ts:69-74` で確認)ため、DO 状態で冪等キーを記憶する案3の機構は屋上屋。**ステートレス Worker(`@hono/mcp` + Streamable HTTP)を採用する**(`docs/design.md` 既定の `@hono/mcp` 構成を踏襲)。

3. **薄いラッパに徹する。** 各ツールは `apps/web/src/api/routes.ts` と同型の `makeContext(env) → (write は Zod safeParse) → core 関数 → MCP content 返却` の1パターンに統一する。write は **必ず** `@ghs/core/services`(§8.5 全write一点経由)、read は `services/workout`(ctx 受領)と `db/repositories` 経由。MCP 層に生 SQL / `db.exec` を一切書かない。

4. **安全作り込みは案3を DO 抜きで取り込む。** clientRequestId の MCP 生成方針、削除の echo+confirm、logWeight の soft-guard、`ghPushed`/`ghDeleted` の正直報告、write/delete の構造化ログ、単位をパラメータ名に埋める指針を全面採用。

---

## 1. 目的 / 非目標 / 前提

### 1.1 目的

- **Claude(claude.ai / Desktop / Code)を Logbook の authoring クライアントにする薄い接合点**を提供する。
- Claude 経由で **食事 / ワークアウト / 体重を記録**し、**D1 を正本**として、食事・体重は **GH へ一方向 push** する(app/MCP → D1 → GH)。
- **トレーナー AI 分析用の構造化 read** を提供する(種目軸の時系列、PR、部位別ボリューム等)。`docs/design.md` §10.2/§10.4 の「UI 詳細閲覧 ≠ AI 分析」役割分離に従う。
- 写真からの食事記録(`log_meal_photo`)= Claude 視覚解析の価値が最大であり MCP の中核機能(`docs/design.md:858`)。

### 1.2 非目標

- **マルチテナント / 複数ユーザー**(`docs/design.md` §11)。オーナー1名専用。
- **UI 向けの細かな閲覧 API を MCP に出す**こと(役割分離 §10.2)。
- **GH からの栄養 pull**(echo 回避のため構造的に提供しない)。
- **任意 ID の無確認削除 / 広範な編集**(直近取消のみ。広範編集は UI に寄せる §10.4)。
- **旧 `fitbit-googlehealth-mcp` との後方互換**(`docs/design.md:926`、後方互換なしで作り直し)。
- **Durable Object / WebSocket / セッション状態**(§0-2)。

### 1.3 前提(SoT 由来)

- 単一ユーザー・低 QPS・個人アプリ。過剰実装は不要。
- 秘密情報は **gitignore のみ**(`.dev.vars` ローカル + Wrangler secrets)。絶対にコミットしない。
- web と mcp は **別 Worker・同一 D1/KV 共有**(`docs/design.md` §3)。cron は web 側に相乗り(mcp に cron は付けない)。
- SoT 2層: **D1 = authoring 正本**(食事/ワークアウト/手入力体重)/ **GH = sensing 正本**(睡眠/HR/HRV/SpO2 等は pull して表示のみ)。
- GH 食事 push は `FEATURE_GH_NUTRITION_PUSH` feature flag 配下(`docs/design.md` §5.2/§14#1、M0 実測ゲート待ち)。flag OFF でも D1 正本で記録は失われない。

---

## 2. アーキテクチャ(テキスト図)

```
                      outbound 160.79.104.0/21
                      ?secret=<MCP_SHARED_SECRET>(URL埋め込み, fail-closed)
  ┌─────────────┐   POST /mcp (Streamable HTTP)   ┌──────────────────────────────┐
  │  Claude     │ ──────────────────────────────▶ │  apps/mcp (MCP Worker)        │
  │ claude.ai / │                                 │  ghsidecar-mcp                │
  │ Desktop /   │ ◀────────────────────────────── │  guard: secret(必須) + IP二次 │
  │ Code        │     tools/list, tool result     │  @hono/mcp StreamableHTTP     │
  └─────────────┘                                 │  McpServer(リクエスト毎 new)   │
                                                   │  各tool = 薄いラッパ           │
                                                   └───────────────┬──────────────┘
                                                                   │ makeContext(env)
                                                                   │ ┌─ write → @ghs/core/services(§8.5)
                                                                   │ ├─ read  → services/workout + db/repositories
                                                                   ▼ ▼
                                                  ┌────────────────────────────────────┐
                                                  │  @ghs/core (packages/core)           │
                                                  │  services: logMeal/saveWorkout/...   │
                                                  │  repositories: search/recent/...     │
                                                  │  AppContext{db,tokens,lock,cache,    │
                                                  │   oauth,featureGhNutritionPush,...}  │
                                                  └───────────┬──────────────┬───────────┘
                                                              │ 正本 write   │ GH push (best-effort, 一方向)
                                                              ▼              ▼
              ┌────────────────────┐  共有(同一ID)  ┌──────────────┐   ┌──────────────────────────┐
              │  apps/web (Worker) │◀──────────────▶│ D1: ghsidecar│   │ Google Health API        │
              │  PWA + Hono API    │   同一 D1      │ (本体・真実)  │   │ nutrition / exercise /   │
              │  + cron */5 相乗り │                └──────────────┘   │ body write (writeonly)   │
              └─────────┬──────────┘                 ▲                  └──────────────────────────┘
                        │ cron reconcile             │ 共有 KV(同一ID): TOKENS / LOCK / CACHE
                        └────────────────────────────┘   GH OAuth token(失効60s前 lazy refresh, LOCK排他)
```

要点:

- **MCP Worker は D1 を直叩きしない。** 必ず `@ghs/core` の services/repositories 経由(§8.5 を物理的に担保)。
- web/mcp は **同一 D1(`database_id 47f59419-…`)と同一 KV(TOKENS/LOCK/CACHE)を個別バインド**して共有する(D1 は同一アカウント内の複数 Worker から個別バインド可)。Service Binding RPC は採らない(理由 §7.4)。
- GH への push に使う access token は **系統 B(GH OAuth)**で、web/mcp が共有 KV `TOKENS` を読み、`@ghs/core` の `getAccessToken`(失効 60s 前 lazy refresh + `LOCK` 排他)を再利用する。MCP は GH の OAuth フローには関与しない(初期 token は既存 `tools/oauth-bootstrap` CLI で投入済み前提)。
- cron は **web 側のみ**。mcp に cron トリガを付けない(GH push 失敗の再試行は web の cron reconcile が担う)。

---

## 3. トランスポート & ホスティング

### 3.1 採用

- **トランスポート: Streamable HTTP 単一エンドポイント `POST /mcp`。** MCP 2025-03 仕様の現行標準。SSE は deprecated のため新規には配信しない(旧クライアント互換が必要になった場合のみ別途 SSE を併設)。
- **ホスティング: ステートレス Worker。** `@hono/mcp`(既存依存 `^0.2.0`)の `StreamableHTTPTransport` を Hono アプリ上に張り、`@modelcontextprotocol/sdk`(既存 `^1.29.0`)の `McpServer` に橋渡しする。`docs/design.md` の `@hono/mcp` 構成を踏襲する。
- **Durable Object は使わない**(`docs/design.md:159`、§0-2)。セッション跨ぎ状態・WebSocket・elicitation は不要。

### 3.2 却下案(各1行)

- **`McpAgent` + Durable Object(案1/案3)**: SoT が DO 不採用を明記。単一ユーザー低 QPS の authoring には過剰(migrations `new_sqlite_classes` 追記・WebSocket Hibernation・依存追加が便益を上回る)。
- **OAuth(`@cloudflare/workers-oauth-provider`)で AS 化(3案共通)**: §6.3 確定の `MCP_SHARED_SECRET` を覆す根拠が示されておらず(静的 Bearer と URL secret の混同)。§4.7 に保留。
- **Service Binding RPC で web 越しに core 呼び出し**: 層が増え、ローカル 2 Worker 同時起動で被呼側が D1 を見失う既知 issue(workers-sdk #11121)に当たる。直接バインドで回避(§7.4)。
- **`createMcpHandler`(`agents/mcp`, DO 不要 stateless)**: これでも要件は満たすが、SoT 既定の `@hono/mcp` を尊重し新規依存(`agents`)を増やさない。`@hono/mcp` + provider 橋渡しに難があれば本案へ切替できる退避路として保持(§9 リスク)。

### 3.3 最小 Worker 骨子(擬似コード — ファイルは作らない)

```
// apps/mcp/src/index.ts(M2 で実装。現状 export {} のプレースホルダを置換)
// 依存: hono, @hono/mcp, @modelcontextprotocol/sdk, @ghs/core(workspace:*), zod

import { Hono } from 'hono';
import { StreamableHTTPTransport } from '@hono/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeContext, /* services, repositories, Zod schemas */ } from '@ghs/core';

const app = new Hono<{ Bindings: Env }>();

// (A) ガード: 一次=MCP_SHARED_SECRET(fail-closed)、二次=outbound IP allowlist。§4
app.use('/mcp', secretAndIpGuard);  // secret 不一致 or 欠落 → 401 即時(fail-closed)

// (B) MCP エンドポイント。McpServer は SDK 1.26+ 要件によりリクエスト毎に new。
app.all('/mcp', async (c) => {
  const server = buildServer(c.env);     // ツール登録 factory(下記)。毎リクエスト生成
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);     // Streamable HTTP 応答
});

function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: 'logbook', version: '1.0.0' });
  const ctx = () => makeContext(env);    // AppContext を都度組む(apps/web と同型)

  // 例: write tool(§8.5 全write一点経由)
  server.tool(
    'log_meal',
    'D1正本へ食事を記録しGHへ一方向push。栄養はGHからpullしない。',
    LogMealInputSchema.shape,            // core の Zod をそのまま inputSchema に
    { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async (raw) => {
      const parsed = LogMealInputSchema.safeParse(raw);
      if (!parsed.success) return toolError(parsed.error);   // actionable な誤入力ガイド
      const input = ensureClientRequestId(parsed.data);      // §6: MCPがUUID生成・再利用
      const r = await logMeal(ctx(), input);                 // services 経由
      return toolText({ mealId: r.mealId, ghPushed: r.ghPushed, idempotentHit: !r.ghPushed });
    },
  );

  // 例: read tool(provenance 付与)
  server.tool(
    'get_exercise_history',
    '種目の全セット時系列(生値+計算済みload_kg/e1rm_kg)。トレーナーAI分析の中核。',
    { exercise: z.string(), since: z.string().optional(), limit: z.number().int().max(2000).optional() },
    { readOnlyHint: true, openWorldHint: false },
    async ({ exercise, since, limit }) => {
      const c = ctx();
      const exerciseId = await resolveExerciseId(c, exercise);  // 部分一致→曖昧は候補配列で曖昧エラー
      const sets = await getExerciseHistory(c, exerciseId, { since, limit });
      return toolText({ provenance: 'd1_confirmed', sets });
    },
  );
  // ... 他ツールも同型
  return server;
}
```

---

## 4. 認証・認可

### 4.1 採用方式(SoT §6.3 確定)

**一次防御 = URL 埋め込み `MCP_SHARED_SECRET`(fail-closed)。二次防御 = Anthropic outbound IP allowlist。** claude.ai には **OAuth なし Custom Connector** を登録する。`docs/design.md:301` / `docs/design.md:935`。

- **静的 Bearer ヘッダ**は claude.ai Web の連携 UI に入力欄が無く不採用。**URL 埋め込み secret は対応**(Custom Connector の接続 URL にクエリ/パスとして埋め込む)。この区別が 3案の倒れた前提を是正する(§0-1)。
- **authless は不採用**(到達者全員が個人健康データを書ける)。

### 4.2 claude.ai から繋ぐ具体的フロー

```
1. オーナーが claude.ai の「カスタムコネクタを追加」に MCP URL を入力:
     https://ghsidecar-mcp.tachibanayu24.workers.dev/mcp?s=<MCP_SHARED_SECRET>
   (secret は URL に埋め込む。OAuth フロー無し。Bearer/ヘッダ手入力も無し)
2. Claude が /mcp に POST(Streamable HTTP, MCP initialize / tools/list)。
3. MCP Worker のガード(secretAndIpGuard):
   (a) 一次: クエリ/パスの secret を MCP_SHARED_SECRET(Wrangler secret)と定数時間比較。
       不一致 or 欠落 → 401 即時(fail-closed)。これが認証の主体。
   (b) 二次: 送信元 IP を ANTHROPIC_OUTBOUND_CIDR(vars, 既定 160.79.104.0/21)で照合。
       範囲外は拒否。ただし IP は変動前提で「緩めても secret で防御」(fail-open は IP のみ)。
       IP値はハードコードせず vars 外出し+公式ページ定期確認(docs/design.md:307)。
4. ガード通過 → tools/list を返し、以降の tool 呼び出しを処理。
```

- **ディスカバリ不要**: OAuth を使わないため `/.well-known/oauth-protected-resource`(RFC 9728)・AS メタデータ(RFC 8414)・DCR(RFC 7591)は配信しない。これにより **OAUTH_KV も不要**で、DCR によるクライアント蓄積も発生しない(OAuth 採用時のコストを丸ごと回避)。

### 4.3 秘密管理(gitignore のみ)

| 種別 | 値 | 置き場所 |
|---|---|---|
| secret(機密) | `MCP_SHARED_SECRET` | Wrangler secret(`.dev.vars` はローカルのみ・gitignore)。**絶対コミット禁止** |
| secret(機密) | `GOOGLE_CLIENT_SECRET`(GH push の系統 B 用、refresh に必要) | Wrangler secret / `.dev.vars` |
| vars(非機密) | `ALLOWED_EMAIL`, `FEATURE_GH_NUTRITION_PUSH`, `ANTHROPIC_OUTBOUND_CIDR`, `PUBLIC_ORIGIN`, `GOOGLE_CLIENT_ID` | `wrangler.jsonc` の `vars` |

IP 値(`160.79.104.0/21`)はハードコードせず `vars` に外出しし、Anthropic 公式ページ(`platform.claude.com/docs/en/api/ip-addresses`)を唯一の真実として定期確認する(`docs/design.md:939` / `docs/design.md:1186`)。

### 4.4 既存 Google OAuth クライアントの再利用可否

- **MCP の入口認証(claude.ai ↔ MCP)には Google OAuth を使わない**(§4.1)。よって系統 A(UI ゲートの Google OIDC、`apps/web/src/auth/session.ts` の `verifyGoogleIdToken`)は MCP では不要。
  - 補足(審査 pitfall への回答): `verifyGoogleIdToken` は **`apps/web` ローカル**にあり `@ghs/core` から export されていない。本書は MCP の入口に OAuth を採らないため **この import 問題は発生しない**。OAuth を将来採る場合(§4.7)に限り、`verifyGoogleIdToken` と email ゲートを `packages/core/auth` へ昇格させてから使う(複製による仕様ドリフトを避ける)。
- **GH push(MCP ↔ Google Health, 系統 B)には既存の GH OAuth トークンをそのまま再利用する。** web と同一 client(`461731861186-…`)で取得済みの refresh token を共有 KV `TOKENS` から読み、`getAccessToken` で lazy refresh する。**MCP のために GCP コンソールへ追加作業(redirect_uri 登録等)は不要**(これも OAuth 不採用の利点)。
- GH トークン失効(系統 B)は read 応答に `getGhAuthError` を反映し、当日 sensing 取得失敗時に「GH 再認証が必要」を Claude へ伝える(§6.4)。

### 4.5 認可(ツール層)

- MCP の入口は secret で守られ、到達できるのは事実上オーナーのみ。`ALLOWED_EMAIL` は vars に保持するが、入口認証が secret 方式のため **OAuth のような per-claim email 再検証は行わない**(呼び出しに identity が乗らない)。
- 安全側として、**書き込み系は §6 の確認/冪等/soft-guard を必須化**する(誤記録予防は identity ではなく操作セマンティクスで担保)。
- アノテーション(`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`)は **UX ヒントであり信頼境界ではない**。secret ガードと Zod `safeParse` を必ずサーバ側で実行する。

### 4.6 系統 A / B の関係(明確化)

- **系統 A(UI ゲート, Google OIDC)**: web 専用。MCP は使わない。
- **系統 B(GH データ用 OAuth)**: MCP の write(GH push)で必要。web/mcp が共有 KV `TOKENS`/`LOCK` 経由で同一トークンを使う。
- **MCP 入口認証**: `MCP_SHARED_SECRET`(系統 A/B のいずれとも独立)。

### 4.7 保留: OAuth 代替経路(採るなら明示判断が必要)

将来 OAuth(`@cloudflare/workers-oauth-provider` + Google upstream + 単一 email ゲート)へ切り替える条件・コスト:

- **採る条件**: 「Google upstream による identity と paste-URL → Google 同意の UX」が、下記新規コストを上回ると明示判断できた場合のみ。
- **新規コスト**: ① `OAUTH_KV` 新設、② DCR(RFC 7591)による接続毎クライアント蓄積(`clientRegistrationTTL` 任せの肥大)、③ GCP コンソールへ MCP 用 redirect_uri 追加登録、④ props 暗号化配線、⑤ `verifyGoogleIdToken`/email ゲートの `packages/core/auth` 昇格(複製回避)、⑥ `/.well-known/*` を Hono ルーティングが奪わない配慮。
- **採る場合の必須**: email ゲートは `email_verified===true` かつ `email===ALLOWED_EMAIL` 完全一致(+ `ALLOWED_SUB` を AND 配線)を `completeAuthorization` 前に実行、不一致は 403。各ツールで `this.props.claims.email` を再照合(fail-closed 二重 authz)。Google トークンを下流へパススルーしない(MCP 認可仕様 MUST NOT)。

---

## 5. ツールカタログ

### 5.1 設計原則

- **全 write は `@ghs/core/services` 経由**(§8.5)。MCP に生 SQL を書かない。
- **全 read に `provenance` を付す**: 前日(JST)以前 = `d1_confirmed`、当日未ミラー sensing = `gh_provisional`(+ `as_of` タイムスタンプ)。栄養は常に D1 正本のみ(`d1_confirmed`)。
- **生値 + 計算済み値の両方を返す**(e1RM 式の再実装不要・独自分析の自由も両立、`docs/design.md:651`)。
- **正規化値は kg/ml 固定**。フィールド名に `_kg` / `_kcal` / `_ml` サフィックスを付け、`entry_unit` は `kg|lb` を明示(単位誤変換の最重要対策)。
- **種目名解決は部分一致**。複数候補・0件は **曖昧エラーで候補配列を返す**(`docs/design.md:925`)。確実な解決は `search_exercises` で id を得てから。
- **GH push 成否を正直に返す**: write は `ghPushed`、delete は `ghDeleted` を必ず結果に含める(best-effort 握り潰しで「GH に入った」と誤認させない)。

### 5.2 ツール一覧(表)

read = 環境を変更しない / write = 追記(非破壊・冪等) / destructive = 取消(直近のみ)。

| # | ツール | 種別 | 目的 | 呼ぶ core | 返却(Claude へのフィードバック) | 冪等 |
|---|---|---|---|---|---|---|
| R1 | `get_exercise_history` ★中核 | read | 種目の全セット時系列(生値+計算済み)。AI 分析の生命線 | `services/workout.getExerciseHistory(ctx, exerciseId, {since?,limit?})` | `{provenance:'d1_confirmed', sets:[{set_index,set_type,entry_value,entry_unit,load_mode,load_basis,reps,rpe,load_kg,set_volume_kg,e1rm_kg,session_date}]}` | N/A |
| R2 | `get_muscle_volume` | read | 部位別 週間ボリューム+目標比較。弱点部位分析 | `services/workout.getMuscleVolume(ctx, {windowDays?})` | `[{muscle,actual_sets,volume_kg,target_sets,stimulus,vs_target}]` | N/A |
| R3 | `get_muscle_calendar` | read | 直近 N 日 部位×日 ヒートマップ。頻度・分割の俯瞰 | `services/workout.getMuscleCalendar(ctx, {days?})` | `{days,sessionDates:[...],cells:[{date,muscle,sets}]}` | N/A |
| R4 | `get_recent_sessions` | read | 直近ワークアウトセッション一覧。delete 対象 id 特定にも使う | `db/repositories.getRecentSessions(ctx.db, limit)` | `[RecentSessionRow]` + `provenance:'d1_confirmed'` | N/A |
| R5 | `get_recent_prs` | read | PR 台帳(暫定/確定を `is_provisional` で区別) | `db/repositories.getRecentPrs(ctx.db, limit)` | `[{record_type,value,unit,rep_bucket,achieved_at,is_provisional,pr_basis}]` | N/A |
| R6 | `search_exercises` ★解決 | read | 種目候補の部分一致検索 = id 解決の起点 | `db/repositories.searchExercises(ctx.db, opts)` | `[{id,name_en,name_ja,equipment,laterality,load_basis,is_bodyweight,bw_factor,primary/secondary_muscles}]` | N/A |
| R7 | `autocomplete_foods` | read | 過去記録食品の PFC 再利用候補(log_meal 補助) | `db/repositories.autocompleteFoods(ctx.db, q, limit)` | `[MealItem]` | N/A |
| R8 | `get_day` | read | 指定日の日次俯瞰(食事 PFC 合計+明細・ワークアウト・体重) | `db/repositories.getMealsByDate` 等を集約 | `{date, nutrition, workout, body, provenance}`(当日 sensing は `gh_provisional`+`as_of`) | N/A |
| R9 | `get_settings` | read | 単位/e1RM 式/栄養目標/週間目標セット数。AI が式・単位を合わせる | `db/repositories.getSettings(ctx.db)` + `getActiveNutritionTarget(ctx.db)` | `{unit_preference,e1rm_formula,nutrition_target,weekly_target_sets}` | N/A |
| W1 | `log_meal_photo` ★維持 | write | 写真→Claude 視覚解析→items[]→食事記録+GH push。MCP 最大の価値 | `services/logMeal(ctx, input)` | `{mealId, ghPushed, idempotentHit}` | clientRequestId(MCP 生成) |
| W2 | `log_meal` | write | テキスト/構造化食事を記録+GH push | `services/logMeal(ctx, input)` | `{mealId, ghPushed, idempotentHit}` | clientRequestId(MCP 生成) |
| W3 | `log_preset` | write | D1 preset から食事記録 | `services/logMeal(ctx, {presetId, ...})` | `{mealId, ghPushed, idempotentHit}` | clientRequestId(MCP 生成) |
| W4 | `save_meal_preset` | write | よく食べる構成を D1 preset 保存 | `services/saveMealPreset(ctx, input)` | `{presetId}` | 名前重複は core 挙動に委譲 |
| W5 | `log_workout` | write | 自然言語/構造化ワークアウトを記録(e1RM/PR は core 計算) | `services/saveWorkout(ctx, input)` | `{sessionId, totalVolumeKg, newPrs, idempotentHit}` | clientRequestId(MCP 生成) |
| W6 | `log_weight` | write | 体重/体脂肪の手入力+GH push | `services/logWeight(ctx, input)` | `{id, ghPushed}` | **clientRequestId 無し** → soft-guard(§6.3) |
| W7 | `set_nutrition_target` | write | 栄養目標(phase/PFC/kcal)設定。AI が目標基準で分析・提案 | `services/setNutritionTarget(ctx, input)` | `{ok:true}` | 上書き(idempotent) |
| D1 | `delete_recent_log` | destructive | 直近の食事 or ワークアウトの取消のみ(D1 削除 + GH datapoint best-effort delete) | `services/deleteMeal(ctx, mealId)` / `services/deleteWorkout(ctx, sessionId)` | `{deleted, ghDeleted}` | `idempotentHint:true`(同 id 再削除は no-op) |

**除外したツール(根拠)**:

- `append_to_workout`(案1): core に in_progress 合流 / `getInProgressSession` が **存在しない**(審査検証済)。§8.5 を守るには合流ロジックを core 側 `saveWorkout` に追加する必要があり初版スコープを膨らませる。当面は `log_workout`(`status` フィールド + 既存 `saveWorkout`)に寄せ、append は **core 改修後の将来拡張**(§9)。
- `get_sensing`/`get_nutrition_log`/`get_training_frequency`(案1/案3): 当面は `get_day`(R8)で sensing/栄養を俯瞰でき、`get_recent_sessions`(R4)/`get_muscle_calendar`(R3)で頻度を代替できる。読取面の最小から始め、必要が出たら段階追加(§7.6 ロールアウト)。

### 5.3 各ツールの inputSchema 概要(core Zod 対応)

`@ghs/core/domain/inputs.ts` の Zod をそのまま inputSchema に転用し、サーバ側で再度 `safeParse` する(web routes と同一契約)。

```
log_meal / log_meal_photo:
  LogMealInputSchema {
    items: MealItemInputSchema[1..50]  // foodName, caloriesKcal(必須), proteinG/fatG/carbsG/
                                        //   fiberG/sugarG/sodiumMg(任意), quantity/unit(任意)
    mealType(必須 enum), date?(YYYY-MM-DD), loggedAtSec?, note?,
    inputMethod?(manual|photo|preset), presetId?, clientRequestId?(MCP生成)
  }
  // log_meal_photo は inputMethod='photo' をサーバ側で固定注入。
  // 画像は Claude 側で解析済み items[] を受ける前提(fact「写真→Claude視覚解析→items[]」)。
  //   → 画像バイナリ受信は実装しない(log_meal とほぼ同型)。§9 で確認事項として明記。

log_preset:
  { presetId(必須), mealType?, date?/loggedAtSec?, clientRequestId? } → LogMealInputSchema(presetId経路)

save_meal_preset:
  { name, defaultMealType(MealType), items: MealItemInputSchema[] }

log_workout:
  SaveWorkoutInputSchema {
    exercises[1..40]{ exerciseId(必須・search_exercisesで解決), note?, sets[0..50]{ setType(main|warmup..),
      loadMode, entryValue, entryUnit, reps, rpe, ... } }
    date?, title?, startedAtSec?, endedAtSec?, bodyweightKg?, status?(in_progress|completed), clientRequestId?(MCP生成)
  }

log_weight:
  LogWeightInput { entryValue(必須), entryUnit('kg'|'lb', 必須・名前と説明に単位明示),
                   bodyFatPct?(%), date?/measuredAtSec? }
  // LogWeightInput は service 側 interface のため MCP 用に同型 zod を1つ定義して safeParse。

set_nutrition_target:
  SetNutritionTargetInput { phase(bulk|cut|maintain), kcal, proteinG, fatG, carbsG, saltG?, fiberG?, dateFrom? }

delete_recent_log:
  { type:('meal'|'workout'), id, confirm?:boolean }  // §6.4 の echo+confirm 二段

read 系:
  get_exercise_history { exercise(id/名前), since?(YYYY-MM-DD), limit?(<=2000) }
  get_muscle_volume    { windowDays?(既定7) }      // ★ {windowDays} オブジェクト引数(positional不可)
  get_muscle_calendar  { days?(既定30) }            // ★ {days} オブジェクト引数
  get_recent_sessions  { limit?(既定30) }
  get_recent_prs       { limit?(既定20) }
  search_exercises     { query?, muscle?, equipment?, favorite?, limit?(<=50) }
  autocomplete_foods   { q, limit?(既定8) }
  get_day              { date?(YYYY-MM-DD, 既定 今日JST) }
  get_settings         {}（引数なし）
```

> 実装注意(審査検証済): `getMuscleVolume` は `{windowDays}`、`getMuscleCalendar` は `{days}` の **オブジェクト引数で ctx を受け `services/workout.ts` にある**。`getExerciseHistory(ctx, exerciseId, {since?,limit?})` も同所。`searchExercises`/`autocompleteFoods`/`getRecentSessions`/`getRecentPrs`/`getSettings`/`getMealsByDate` は **`db/repositories`** にあり `ctx.db` を取る。positional な `getMuscleVolume(ctx, window)` と書くと型が合わない。

### 5.4 破壊的操作を出すか(根拠)

**出す。ただし `delete_recent_log`(直近取消)のみ。** 根拠:

- `docs/design.md:920` が「直近の食事/ワークアウト/セットの取消のみ(誤記録の undo)。広範な編集は UI に寄せる」と確定。
- オーナー自身の誤記録 undo は authoring UX 上必要。任意 ID の無確認削除・任意期間一括削除・上書き編集は **出さない**(誤削除リスク)。
- annotation: `destructiveHint:true` / `idempotentHint:true`(同 id 再削除 no-op)/ `openWorldHint:true`(GH datapoint delete を伴う)。これは Claude 側の確認 UX 用ヒントであり、サーバ側の echo+confirm(§6.4)を別途必須化する。

### 5.5 利用者AIレビュー反映(実装前に確定する契約)

2026-06-02、本MCPの利用者となる Claude(トレーナーAI)のレビュー(`docs/mcp-review-packet-answer.md`)を反映。評価は **致命的問題ゼロ・実装可**。以下は「利用者の誤用を減らすための契約明確化」で、実装前にスキーマ説明へ落とす。

**A. `get_exercise_history`(R1)の名前解決を「エラーで突き返さない」** — `exerciseId`(推奨)を受ける。`exercise`(名前)も許すが、曖昧時は**例外でなく構造化応答**を返す:

- 一意ヒット → 履歴を返す。
- 複数ヒット → 履歴を返さず `{ ambiguous:true, candidates:[{id,name_en,...}], hint:'exerciseId で再呼び出し' }`。利用者は一手で候補を得て即再呼び出しでき、往復が「曖昧エラー→search_exercises→再呼び出し」の3手から2手に減る。

**B. `log_workout`(W5)の `loadMode` 既定と `weighted` 時の `entryValue` 必須** — 既定は **exercises マスタの `load_basis`/`is_bodyweight` に従う**(`saveWorkout` 実挙動: `loadMode ?? (is_bodyweight ? 'bodyweight' : 'weighted')`)。よって利用者は通常 `loadMode` を省略してよい(説明に明記)。ただし:

- `weighted` で `entryValue` が null/欠落だと**ボリュームが静かに 0 になる** → **weighted は `entryValue` 必須**を schema 説明に明記し、core `SaveWorkoutInputSchema` に `superRefine`(loadMode 解決後に weighted⇒entryValue 必須)を追加。
- `bodyweight` は `entryValue` 任意(自重)。`assisted` は `entryValue`=アシスト量(軽減方向)。自重ディップス(8→4回, entryValue 無し)を正しく通すための規約。

**C. `log_weight`(W6)soft-guard の応答スキーマを定義** — 同日に近い体重があれば書き込まず警告を返す(レスポンス形を確定):

```jsonc
{ "status": "similar_exists", "requireConfirm": true,
  "existing": { "id": "...", "weight_kg": 72.4, "body_fat_pct": 15.0, "measured_at": 1750000000 },
  "message": "同日に 72.4kg の記録があります。別測定なら confirm:true で記録します。" }
```

利用者は別測定なら**同じ入力に `confirm:true` を足して再呼び出し** → 実行され `{ id, ghPushed }`。朝晩の複数測定はこれで許容(soft-guard は別測定を拒否しない)。`log_weight` 入力に `confirm?:boolean` を追加。

**D. `delete_recent_log`(D1)の「直近」を具体定義** — 対象は「**当日(JST)に作成された meal/workout、または種別ごと最新3件**」のいずれか(新しい側に倒す)。範囲外は actionable エラーで `get_recent_sessions` 誘導。これにより「さっきのトレ消して」がどこまで効くか利用者が予測できる。

**E. 訂正フローの明示** — `update_*`(編集)は出さない(誤上書き回避)。**訂正 = `delete_recent_log` + 再 `log_*` の2手が公式フロー**。`delete_recent_log` の説明に「重量等の訂正はこのツールで取消後に再記録」と明記し、利用者が存在しない update を探す事故を防ぐ。

**F. 種目解決の頑健性(最重要・体感品質の最大要因)** — `search_exercises` のヒット率がアプリ体感を最も左右する。英語 free-exercise-db ベースのため、**日本語俗称・マシンブランド名(「アイソラテラル」「ハンマーストレングス」)・略称**が引けないと記録のたびに往復が増える。対策:

- `name_ja` を主要種目で整備し、**エイリアス辞書 `exercise_aliases(exercise_id TEXT, alias TEXT)`**(または `exercises.aliases` JSON 列)を追加、`searchExercises` を **name_en/name_ja/alias 横断**の部分一致に拡張(core repo 改修)。
- MVP 前に主要種目の別名を投入し、運用後にミスヒットを継続拡充。`search_exercises` の説明に「日本語俗称・マシン名でも検索可」を明記。

**G. `get_training_frequency`(R10・fast-follow)を追加** — `get_muscle_calendar`(部位×日セル)からの集計は利用者側処理が重く即応性を落とす。**部位別の最終実施日 + 直近4週の週次頻度**を返す軽量 read を MVP 直後に追加:

```
get_training_frequency { weeks?(既定4) }
→ [{ region, last_trained_date, days_since, weekly_counts:[w1,w2,w3,w4] }]
```

「この部位2週間空いてる」「ベンチ週2で回せてる」を即答可能に。MVP は `get_muscle_calendar` で代替しつつ、運用開始後に**必ず実用性を再評価**(レビュー③)。

---

## 6. 冪等・安全・一方向同期の担保

### 6.1 冪等(clientRequestId)— core 既存機構へ委譲

- core は既に冪等を持つ(検証済):
  - `logMeal`: `SELECT id FROM meals WHERE client_request_id=? LIMIT 1` で既存検出 → あれば `{ mealId: 既存id, ghPushed:false }` を返し再 push しない(`nutrition.ts:51-58`)。
  - `saveWorkout`: `SELECT id FROM workout_sessions WHERE client_request_id=? LIMIT 1` → あれば `{ sessionId: 既存id, totalVolumeKg:0, newPrs:[] }`(`workout.ts:69-75`)。
- **MCP 層の責務(案3 由来・DO 抜き)**: clientRequestId を **Claude/transport 任せにせず、同一論理操作には同一値を再利用**させる。
  - tool description に「同一の記録の再送防止に同じ `clientRequestId` を再利用せよ。省略時はサーバが `crypto.randomUUID()` を生成する」と明記。
  - サーバは **論理操作ごとに新 UUID を勝手に振らない**(振ると再送が別記録になり二重登録)。Claude が clientRequestId を指定しない初回呼び出しでのみ生成し、Claude には生成値を結果に含めて返す(以降の明示的リトライで再利用できるよう)。
  - DO 状態での「入力ハッシュ→ID 記憶」(案3)は **採らない**(DO 不採用 §0-2)。core の SELECT-dedup で十分。

### 6.2 read には冪等性なし(副作用なし)

read は環境を変更しないため冪等の概念対象外。`readOnlyHint:true` を付す。

### 6.3 logWeight の soft-guard(clientRequestId が無い事実への対処)

- **検証済事実**: `logWeight`(`body.ts:22`)は `LogWeightInput` を取り、**`clientRequestId` を持たない**。よって体重の二重記録は core レベルでは防げない。
- **短期 soft-guard(案3 由来)**: `log_weight` 実行前に同日(`date`)の `body_metrics` を `get_day` 相当で参照し、直近に同値(`entryValue`+`entryUnit`+`bodyFatPct` 近接)があれば **書き込み前に警告を返す**。**応答スキーマ・`confirm:true` 再呼び出しは §5.5-C で確定**(朝晩の別測定は許容)。過剰な MCP 独自冪等(DO 記憶)は採らない。
- **恒久対策(将来 §9)**: `LogWeightInput` / `logWeight` に `clientRequestId` を追加して core レベルで冪等化する(別タスク)。

### 6.4 破壊的操作の確認セマンティクス(echo + confirm)

`delete_recent_log` は **二段**で安全化する(案3 由来):

1. **対象 echo(confirm 省略時)**: `{ type, id }` を受けたら、まず対象が「直近」か検証(**直近の定義は §5.5-D**: 当日JST 作成 or 種別ごと最新3件)。範囲外なら **actionable エラー**(「直近の取消のみ対応。get_recent_sessions で対象を確認してください」)。範囲内なら **削除せず**対象内容を echo(例:「`mealId=… の 鶏胸肉 250kcal x3` を削除します。`confirm:true` で実行」)。
2. **実行(confirm:true)**: `type=meal → deleteMeal(ctx, mealId)` / `type=workout → deleteWorkout(ctx, sessionId)`。返り値 `{ deleted, ghDeleted }` をそのまま Claude に返す。
3. annotation は信頼境界でないため、上記サーバ側ガード + Zod safeParse を必ず実行する。

> elicitation(MCP プロトコルの確認 UI)は DO 不採用のため当面使わない。echo+confirm の二段ツール契約で代替する。

### 6.5 一方向同期と echo 回避

- 食事は **app/MCP → D1(正本)→ GH push の一方向のみ**。MCP は **GH から栄養を pull するツールを一切公開しない**(`get_day`/read の当日 sensing は睡眠/HR 等のみ provider 速報、栄養は D1 正本のみ)。これにより GH→D1 の栄養 echo 経路を構造的に作らない。
- own-write echo 防止(`gh_datapoint_id`/`gh_data_origin`)は **core に委譲**し MCP は触れない。
- `FEATURE_GH_NUTRITION_PUSH` が OFF なら GH push をスキップ(D1 正本のみ)。`ghPushed:false` を正直に返す。

### 6.6 GH push 成否の正直な報告

- GH push は best-effort(失敗は core が握り潰し、web cron が再試行)。**write は `ghPushed`、delete は `ghDeleted` を必ず結果に含める**。`ghPushed:false` を省略すると Claude が「GH に入った」と誤報告する重大リスク(§9)。
- read(`get_day` 等)の当日 sensing が GH トークン失効で取得失敗した場合、`getGhAuthError` を応答に反映し「GH 再認証が必要」を Claude に伝える。

### 6.7 観測性

- MCP Worker は `observability.enabled:true`。全 write/delete で `{tool, clientRequestId, resultId, ghPushed/ghDeleted}` を構造化ログ。read は件数のみ。誤記録/二重登録ゼロを各ロールアウト段で確認してから次段へ。

---

## 7. デプロイ

### 7.1 Worker 構成

- `apps/mcp` を **新規 Cloudflare Worker(name: `ghsidecar-mcp`)** として独立デプロイ。現状の `apps/mcp/src/index.ts`(プレースホルダ `export {}`)を実装に差し替え、`apps/mcp/wrangler.jsonc` を新規作成。
- web とは別 Worker・同一 D1/KV 共有(`docs/design.md` §3)。cron は付けない。

### 7.2 wrangler bindings(D1/KV 共有)

```jsonc
// apps/mcp/wrangler.jsonc(M2 で作成。値は apps/web/wrangler.jsonc と同一 ID を流用)
{
  "name": "ghsidecar-mcp",
  "account_id": "2ed52fafd3387679d9b97beadf46abee",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },

  "d1_databases": [
    { "binding": "DB", "database_name": "ghsidecar",
      "database_id": "47f59419-a8cb-4537-8047-64b68174e7ca" }
    // ★ migrations_dir は付けない(web をスキーマ単一発行者に固定。二重適用防止)
  ],

  "kv_namespaces": [
    { "binding": "TOKENS", "id": "badca286ba87486491a39ca5702d0a1a" },  // GH OAuth token(共有)
    { "binding": "LOCK",   "id": "fa5e1021b35a4c6b9c485280394a013f" },  // refresh 排他(共有)
    { "binding": "CACHE",  "id": "cba6bf607b654ff29c874fbaf96cbf88" }   // 任意(共有)
    // ★ OAUTH_KV は不要(OAuth 不採用 §4.2)
  ],

  "vars": {
    "ALLOWED_EMAIL": "tachibanayu24@gmail.com",
    "FEATURE_GH_NUTRITION_PUSH": "true",
    "ANTHROPIC_OUTBOUND_CIDR": "160.79.104.0/21",  // 公式追従・ハードコードしない
    "PUBLIC_ORIGIN": "https://ghsidecar-mcp.tachibanayu24.workers.dev",
    "GOOGLE_CLIENT_ID": "461731861186-…"
  }
  // secrets(wrangler secret / .dev.vars・gitignore・非コミット):
  //   MCP_SHARED_SECRET, GOOGLE_CLIENT_SECRET
  // triggers(cron)は付けない(cron は web 相乗り)
}
```

- D1 は同一アカウント内の複数 Worker から個別バインド可。**MCP からは migration を流さない**(`migrations_dir` を付けない)= web をスキーマの単一発行者に固定し二重適用を防ぐ。
- secret 投入: `wrangler secret put MCP_SHARED_SECRET`(本番)/ `.dev.vars`(ローカル)。

### 7.3 @ghs/core 再利用方法

- `makeContext(env)` をそのまま import。MCP の `Env` を `{ DB, TOKENS, LOCK, CACHE?, GOOGLE_CLIENT_ID?, GOOGLE_CLIENT_SECRET?, FEATURE_GH_NUTRITION_PUSH? }` の形に揃える(web と完全同型のデータ経路)。
- write: barrel から `logMeal / saveWorkout / logWeight / saveMealPreset / setNutritionTarget / deleteMeal / deleteWorkout`。
- read: `services/workout` の `getExerciseHistory / getMuscleVolume / getMuscleCalendar`(ctx 受領) + `db/repositories` の `searchExercises / autocompleteFoods / getRecentSessions / getRecentPrs / getSettings / getMealsByDate / getActiveNutritionTarget`(ctx.db 受領)。
- 入力検証: `@ghs/core/domain/inputs` の `LogMealInputSchema / SaveWorkoutInputSchema / MealItemInputSchema` をそのまま `safeParse`。`LogWeightInput / SetNutritionTargetInput` は service interface のため MCP 用に同型 zod を定義。
- 各ツールは `makeContext(env) → (write は safeParse) → core 関数 → content[text]` の1パターンに統一(`apps/web/src/api/routes.ts` と同型でコピー量最小)。

### 7.4 Service Binding を採らない理由

- core が `AppContext` を受ける純関数設計のため、D1/KV を直接バインドすれば web と同一コード経路を共有でき、層を増やさない方が誤記録面が小さい。
- §8.5 は **「write は必ず `logMeal`/`saveWorkout` 経由」**で論理的に担保される(D1 を物理共有しても write 経路は services を通る)。
- ローカルで web/mcp を Service Binding 同時起動すると被呼側が D1 を見失う既知 issue(workers-sdk #11121)を回避できる。将来 write を物理的に1 Worker に集約したくなった時のみ RPC へ移行。

### 7.5 CI

- 既存 pnpm workspaces に乗る。`apps/mcp/tsconfig.json`(workers-types 有効・`extends tsconfig.base`)で `tsc --noEmit`。biome/vitest も既存設定を適用。
- デプロイは `wrangler deploy` を web/mcp で個別。新規パイプライン構築なし。

### 7.6 ロールアウト段階(M2、`docs/design.md` §13)

M2(7〜8月): apps/mcp 構築・ツール D1 経由再実装・secret 一次+IP 二次保護・claude.ai に新 Custom Connector 登録・旧/新 MCP/UI 並行運用。段階:

- **M2-a(接続疎通)**: 認証スケルトン(secret+IP ガード)+ `get_settings`(R9)1本で claude.ai 実接続確認(「URL 入力 → 繋がる」を最優先)。
- **M2-b(read)**: read 群を追加(`get_exercise_history` 中核 + R1〜R9)。provenance 付与を確認。
- **M2-c(write, push OFF→ON)**: write(`log_meal`/`log_workout`/`log_weight`/preset/target)を追加。`FEATURE_GH_NUTRITION_PUSH=false` で D1 のみ確認 → OK 後 `true` で GH push と冪等を実機確認。
- **M2-d(photo + delete)**: `log_meal_photo`(視覚解析)と `delete_recent_log`(echo+confirm)を最後に。
- **ロールバック**: 各段は tool 登録の出し入れだけ。問題時は該当ツール登録を外して再デプロイ。`FEATURE_GH_NUTRITION_PUSH` で GH push を即時無効化可。旧 claude.ai コネクタは後方互換なしで作り直し(`docs/design.md:926`)。

---

## 8. テスト戦略

core 側は既存(`services.integration.test.ts`: logMeal/saveWorkout/deleteMeal/getMuscleVolume 等の冪等・PR 計算・部位帰属)でカバー済み。MCP は薄いラッパなので **MCP 固有面に絞る**:

1. **contract(ツール↔core マッピング)**: 各ツールの「Zod safeParse の通過/失敗が正しく core に届くか」「失敗が actionable な誤入力ガイドになるか」。型は `z.infer` が service interface と構造一致するため大半は型で担保。
2. **冪等回帰**: 同一 `clientRequestId` で `log_meal` / `log_workout` を 2 回呼び、同一 id が返り 2 回目 `ghPushed:false`(`idempotentHit`)で D1 に重複しないこと。
3. **clientRequestId 生成方針**: 未指定時にサーバが UUID を生成し結果に返すこと、論理操作ごとに勝手に新 UUID を振らないこと。
4. **logWeight soft-guard**: 同日近接値で書き込み前警告が出ること。
5. **fake provider 再利用**: `AppContext.provider` に fake を注入し GH push/delete を伴わずに検証(GH push の握り潰し・`ghPushed/ghDeleted` の正直返却)。
6. **delete の安全性**: `delete_recent_log` が範囲外 id で actionable エラー、confirm 省略時に echo のみ・`confirm:true` で削除、`{deleted, ghDeleted}` を返すこと。
7. **認証ガード**: secret 欠落/不一致で 401(fail-closed)、IP 範囲外で拒否(ただし secret 正なら IP 緩めても接続維持)。
8. **手動**: `wrangler dev` + MCP Inspector(`@modelcontextprotocol/inspector`)で `/mcp` に接続 → `tools/list` と各ツールの inputSchema・annotation(readOnly/destructive/idempotent/openWorld)を目視。`curl` でガードの 401/200 を確認。
9. **E2E**: claude.ai に Custom Connector(URL+secret)登録 → read → `log_meal` 二重送信で D1 1件(冪等)→ `log_meal_photo` で写真→記録→`get_day` 反映・`ghPushed:true` → `delete_recent_log` で echo→confirm→消える。

---

## 9. リスク・未決事項・将来拡張

### 9.1 リスク(と緩和)

| リスク | 緩和 |
|---|---|
| MCP から生 SQL / `db.exec` を足すと §8.5(全write一点経由)が崩れる | レビューで「MCP は必ず services/repositories 経由、生 SQL 禁止」を機械的にガード |
| `ghPushed:false` を応答に出さないと Claude が「GH に入った」と誤報告 | write/delete の応答に `ghPushed`/`ghDeleted` を **必須**(§6.6) |
| `logWeight` に冪等キーが無く体重二重記録を完全には防げない | soft-guard(§6.3)で短期緩和、core への clientRequestId 追加を将来対応(§9.3) |
| `@hono/mcp ^0.2.0` + Streamable HTTP の橋渡し実績が薄い | M2-a で疎通を最優先確認。ダメなら `createMcpHandler`(agents/mcp, DO 不要 stateless)へ切替の退避路(§3.2) |
| `MCP_SHARED_SECRET` が URL に乗る(ログ/履歴に残りうる) | Wrangler secret 管理・定数時間比較・IP allowlist 二次防御。secret は再生成可能な運用 |
| 共有 KV(TOKENS/LOCK)の lazy refresh 不具合が web/mcp 双方に波及 | core の `getAccessToken` を単一実装に集約・`getGhAuthError` を read 応答に反映 |
| annotation を信頼境界と誤認 | secret ガード + Zod safeParse をサーバ側で必ず実行(§4.5) |
| Anthropic outbound IP レンジ変動で全断 | IP 値は vars 外出し・公式追従、一次防御は secret(fail-open は IP のみ) |

### 9.2 未決事項(openQuestions)

1. ~~**`log_meal_photo` の責務分界**~~ **【解決】** 利用者レビューで「Claude が視覚解析して items[] を作るのが最精度。画像を MCP に渡す意味はサーバ側別モデル解析時のみで、本アーキの思想に反する。現状維持を推奨」と確認(`mcp-review-packet-answer.md`)。**画像バイナリは受けず、解析済み items[] を受ける**で確定。
2. **OAuth へ切替するか**: §4.7 の利得(identity/UX)が新規コストを上回るかの最終判断。本書は SoT 準拠で secret 方式を既定とする。
3. **`ALLOWED_SUB` の扱い**: secret 方式では入口に identity が乗らないため未配線で十分か(OAuth 採用時のみ AND 配線が要る)。

> 利用者レビューでの read 粒度の懸念(openQuestion 相当)は **§5.5-G(`get_training_frequency` を fast-follow 追加 + 運用後再評価)** で対応。食事の GH push 可否(レビューが M0 の 200/403 ゲート待ちと指摘)は **既に実機 200 OK 確認済・`FEATURE_GH_NUTRITION_PUSH=true` で有効化済**(`apps/web/wrangler.jsonc`, `docs/design.md` §5.2)なので、食事も GH へ反映される(レビューの条件付き注記は解消済)。

### 9.3 将来拡張 / fast-follow

- **fast-follow(MVP直後)**: `get_training_frequency`(§5.5-G・部位別 最終実施日+週次頻度)/ 種目エイリアス辞書 `exercise_aliases`(§5.5-F・日本語俗称/マシン名の検索ヒット率向上)。どちらも利用者レビューで体感品質に直結と指摘。
- `logWeight` / `LogWeightInput` に `clientRequestId` を追加し体重も冪等化(core 改修。soft-guard §5.5-C を恒久化)。
- `log_workout` の `weighted⇒entryValue 必須`(§5.5-B)を core `SaveWorkoutInputSchema` の `superRefine` で実装。
- `append_to_workout`: core 側 `saveWorkout` に in_progress 合流ロジック(`getInProgressSession`)を追加してから MCP ツール化(§5.2 除外理由)。
- `get_sensing` / `get_nutrition_log`: 必要が出たら段階追加(当日 sensing の `as_of`/provenance 実装が最も手数)。
- OAuth 代替経路(§4.7)・elicitation による削除確認(DO 採用時)。
- M4: UI 直写真解析(Workers AI / Claude API)着手後の MCP との役割再整理。

---

## 10. 実装ステップ チェックリスト(承認後そのまま着手)

> M2(`docs/design.md` §13)。各ステップは独立にロールバック可能(tool 登録の出し入れ)。

### フェーズ 0: 基盤(M2-a)

- [ ] 1. `packages/mcp/package.json` の依存を確定(`@ghs/core` workspace:*, `@hono/mcp`, `@modelcontextprotocol/sdk`, `hono`, `zod`)。`agents`/`workers-oauth-provider` は **入れない**(OAuth/DO 不採用)。
- [ ] 2. `apps/mcp/wrangler.jsonc` 新規作成(§7.2 の値)。D1/KV は web と同一 ID を流用、`migrations_dir` を付けない、cron なし、`OAUTH_KV` なし。
- [ ] 3. `wrangler secret put MCP_SHARED_SECRET`(本番)+ `.dev.vars` にローカル値(gitignore 確認)。`GOOGLE_CLIENT_SECRET` も同様。
- [ ] 4. `apps/mcp/src/index.ts`: Hono + `@hono/mcp` の `StreamableHTTPTransport` + `McpServer`(リクエスト毎 new)の骨子(§3.3)。`secretAndIpGuard` ミドルウェア(一次 secret fail-closed + 二次 IP)。
- [ ] 5. `get_settings`(R9)1本だけ登録 → `wrangler dev` + MCP Inspector で疎通 → claude.ai Custom Connector に URL+secret 登録して **実接続確認**。

### フェーズ 1: read(M2-b)

- [ ] 6. `resolveExerciseId`(部分一致・**曖昧は例外でなく `{ambiguous,candidates}` 構造化応答**で返す, §5.5-A)ヘルパ。
- [ ] 7. read ツール登録: `get_exercise_history`(中核・`exerciseId` 推奨/名前曖昧時は候補返却)/`get_muscle_volume`({windowDays})/`get_muscle_calendar`({days})/`get_recent_sessions`/`get_recent_prs`/`search_exercises`(**name_en/ja/alias 横断**, §5.5-F)/`autocomplete_foods`/`get_day`。全て `readOnlyHint:true` + `provenance` 付与(当日 sensing は `gh_provisional`+`as_of`、`getGhAuthError` 反映)。
- [ ] 8. read contract テスト(引数マッピング・provenance・曖昧エラー)。

### フェーズ 2: write(push OFF→ON)(M2-c)

- [ ] 9. `ensureClientRequestId`(未指定時のみ UUID 生成・結果に返す・勝手に振り直さない)。
- [ ] 10. write ツール登録: `log_meal`/`log_preset`/`save_meal_preset`/`log_workout`/`set_nutrition_target`。`destructiveHint:false`/`idempotentHint:true`/`openWorldHint:true`。safeParse → core → `{...result, ghPushed/idempotentHit}` 返却。`log_workout` は **loadMode 既定=load_basis 由来 / weighted⇒entryValue 必須(§5.5-B, core superRefine)** を説明・検証に反映。
- [ ] 11. `log_weight` + soft-guard(同日近接値の事前警告 + `confirm:true` 再呼び出し。応答スキーマは §5.5-C)。
- [ ] 12. `FEATURE_GH_NUTRITION_PUSH=false` で D1 のみ確認 → 冪等回帰テスト(同 clientRequestId で 2 回→1件)→ OK 後 `true` で GH push 実機確認。

### フェーズ 3: photo + delete(M2-d)

- [ ] 13. `log_meal_photo`(`inputMethod='photo'` 固定注入、解析済み items[] 受領、§9.2-1 を確認後)。
- [ ] 14. `delete_recent_log`(echo+confirm 二段、**直近ガードの定義は §5.5-D**、範囲外は actionable エラー、`{deleted,ghDeleted}` 返却、説明に **訂正=取消+再記録の公式フロー §5.5-E** を明記)。
- [ ] 15. E2E(§8-9)+ 構造化ログで誤記録/二重登録ゼロ確認 → 旧コネクタ廃止計画(M4)。

### 横断(全フェーズ)

- [ ] 16. レビュー観点: ①MCP に生 SQL/`db.exec` が無い、②全 write が services 経由、③`ghPushed`/`ghDeleted` を必ず返す、④secret/Zod をサーバ側で必ず実行、⑤秘密が vars/コミットに無い。

# 接続 & デプロイ手順

接続フェーズの実行順。① はオーナー(GCP/Cloudflare)、②③ は CLI、④ で実データ検証 → 必要なら mapper 修正、⑤ 本番デプロイ。

> **接続フェーズ進捗(2026-06-01 時点)**
> - ✅ ①GCP: スコープ実在・テストユーザー登録・OAuth 同意済
> - ✅ ②GHトークン: 取得済(`tools/.gh-tokens.json`, gitignore)。**access_token は失効しても `_token.ts` が refresh_token で自動更新**するので bootstrap は初回1回でよい
> - ✅ ③nutrition write: **200 OK 実機確認** → `FEATURE_GH_NUTRITION_PUSH=true` 化済
> - ✅ ④read mapper: weight/body-fat/sleep/resting-hr/hrv/oxygen/respiratory/steps を実データで確定(§17.5)。残: VO2max(データ無)・skin-temp(ID不明)
> - ⬜ ⑤Cloudflare デプロイ: **未実施**(オーナーの `wrangler login` + リソース作成が必要)

## ① GCP(オーナー作業)
- Google Health API を有効化。
- OAuth 同意画面を **In production** に publish(refresh token の7日失効回避)。
- OAuth クライアント(Web)の「承認済みリダイレクト URI」に両方を登録:
  - ローカル: `http://127.0.0.1:8788/oauth/callback`(bootstrap 用)
  - 本番: `https://<your-worker-domain>/auth/callback`(系統A ログイン用)
- スコープ(最小6): `googlehealth.{activity_and_fitness,health_metrics_and_measurements}.{readonly,writeonly}` + `sleep.readonly` + `nutrition.writeonly`

## ② GH トークン取得(系統B, Pattern B)
```bash
# 認証情報は apps/web/.dev.vars から自動読込。nutrition も要求するなら GH_NUTRITION_PUSH=1
GH_NUTRITION_PUSH=1 pnpm --filter @ghs/tools oauth:bootstrap
# → ブラウザ同意 → access/refresh が出力される
```

## ③ nutrition write 実 grant 確認(§14#1)
```bash
export GH_ACCESS_TOKEN='<②の access_token>'
pnpm --filter @ghs/tools oauth:check     # 200 → FEATURE_GH_NUTRITION_PUSH=true / 403 → false 据置
```

## ④ read mapper を実データ検証(接続最大の未検証点, §17.4)
```bash
export GH_ACCESS_TOKEN='<②の access_token>'
pnpm --filter @ghs/tools gh:probe        # 各 dataType の生JSON と parsed を並べて表示
```
- 各 dataType で parsed の `value` が非null・`timeSec` 妥当なら mapper OK。
- null/HTTP4xx が出たら、raw の実フィールド名に合わせて `packages/core/src/providers/google-health/mappers.ts`(extractValue/extractTimeSec)を修正 → 再 probe。
- resp-rate/skin-temp は dataType ID が要検証(`discovery-pin.ts` の `unverified`)。probe で正しい ID を確認したら外す。

## ⑤ Cloudflare デプロイ
```bash
cd apps/web
# remote リソース作成(初回)
pnpm exec wrangler d1 create ghsidecar          # 返った database_id を wrangler.jsonc に
pnpm exec wrangler kv namespace create TOKENS    # 同様に id を
pnpm exec wrangler kv namespace create CACHE
pnpm exec wrangler kv namespace create LOCK
# remote にスキーマ適用
pnpm exec wrangler d1 migrations apply ghsidecar --remote
# secrets(.dev.vars の値を本番へ)
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put SESSION_SIGNING_KEY
# pnpm exec wrangler secret put ALLOWED_SUB      # 初回ログイン後の Google subject(任意, 厳格化)
# vars: wrangler.jsonc に PUBLIC_ORIGIN=https://<domain>、FEATURE_GH_NUTRITION_PUSH=(④の結果)
#       ★DEV_AUTH_BYPASS は本番 vars に入れない(localhost限定ガードもあるが二重で)
# GH トークンを remote KV(TOKENS)へ。必須は refresh_token のみ。
# expires_at=0 を入れておけば初回アクセス時に access_token を lazy refresh する(②の access は1hで失効するため)。
pnpm exec wrangler kv key put --remote --binding=TOKENS "gh:refresh_token" "$(node -e 'console.log(require("../../tools/.gh-tokens.json").refresh_token)')"
pnpm exec wrangler kv key put --remote --binding=TOKENS "gh:expires_at" "0"
# デプロイ(vite build + wrangler deploy)
pnpm deploy
```
- account 一覧権限の無いトークンの場合は `wrangler.jsonc` に `"account_id": "<id>"` を追加するか `CLOUDFLARE_ACCOUNT_ID` を export。
- KV キー名は `packages/core/src/auth/tokenStore.ts`(`gh:access_token`/`gh:refresh_token`/`gh:expires_at`)と一致。
- cron(`wrangler.jsonc` triggers)で daily pull(日3回)+ gh-push retry(30分毎)が自動実行。
- デプロイ後、`https://<domain>/auth/login` から Google ログイン(dev bypass 無し)で動作確認。

## 注意
- `mappers.ts` の read 応答形は ④ で確定。push 形(create payload)はこちらが握るので ③ の 200 で概ね確証。
- `dataSource.application` の正確な形・Operation 応答の正確な形は ②③④ の実レスポンスで最終確認(現状 best-effort パース)。

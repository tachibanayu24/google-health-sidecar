# Logbook — Google Health sidecar(ボディメイク記録)

単一ユーザー(オーナー本人)向けの、ジム・ボディメイク記録 PWA。**食事とワークアウトはこのアプリが authoring 元(D1 が真実)**、体重・睡眠などのセンシングは Google Health が真実で daily batch で同期(表示)する二層構成。

> 設計の全体像は [`docs/design.md`](docs/design.md)(v3)、UX方針は [`docs/ux-review.md`](docs/ux-review.md)、GH API 調査は [`docs/research-appendix.md`](docs/research-appendix.md)。

## スタック

- **Cloudflare Workers + D1 + KV**(Cron でデイリーバッチ)
- **React 19 + Vite + @cloudflare/vite-plugin**(SPA と Worker API を1プロジェクトで同居)
- Tailwind v4 / TanStack Query / lucide / recharts / react-body-highlighter
- **Hono**(API + 認証ゲート) / Google OIDC(系統A ログイン)+ GH OAuth Pattern B(系統B, 未接続)
- pnpm workspace モノレポ: `packages/core`(ドメイン/DB/services/providers/auth) + `apps/web`(UI+API) + `apps/mcp`(M2) + `tools`(OAuth CLI)

## ローカル起動

```bash
pnpm install
# D1 スキーマ + seed を local に適用(初回)
pnpm --filter @ghs/web exec wrangler d1 migrations apply ghsidecar --local
# 開発サーバ(SPA + /api 同居)。http://localhost:5173
pnpm --filter @ghs/web dev
```

`apps/web/.dev.vars`(gitignore 済)に `DEV_AUTH_BYPASS=1` があるとローカルはログイン不要で動く。`GOOGLE_CLIENT_ID/SECRET`・`SESSION_SIGNING_KEY` も同ファイル。

## 検証

```bash
pnpm -r --if-present typecheck   # 型(core/web/mcp/tools)
pnpm --filter @ghs/core test      # vitest(単位/metrics/GH mapper)
pnpm exec biome check .           # lint/format
pnpm --filter @ghs/web build      # vite build(client + worker)
```

## 実装状況

- **M0(完了)**: モノレポ基盤、ドメイン/metrics、D1スキーマ(21表)、HealthProvider抽象 + GH v4 provider(discovery doc 準拠)、db層、auth(Pattern B)、OAuth CLI。
- **M1(進行中・大部分完了)**: services層(全write一点経由)、/api + 認証ゲート、PWA UI(Today / ワークアウトロガー[前回値・kg/lb・部位フィルタ] / 食事[PFC・食塩相当量・オートコンプリート] / 人体筋肉ヒートマップ[前面+背面] / トレンドチャート / 設定)、Googleログイン。
- 残: 設定編集UI、種目マスタ拡充(free-exercise-db)、食事プリセット、PWA(SW/オフライン/アイコン)、GH実トークン接続(daily pull / push)、MCP(apps/mcp, M2)。詳細は `docs/ux-review.md`。

## オーナー側セットアップ(GH連携・本番)

1. GCP: Google Health API 有効化、OAuth クライアント(Web)、同意画面を **In production** に publish。
2. スコープ(最小6): `googlehealth.{activity_and_fitness,health_metrics_and_measurements}.{readonly,writeonly}` + `sleep.readonly` + `nutrition.writeonly`。
3. 初回トークン: `pnpm --filter @ghs/tools oauth:bootstrap`(redirect_uri は `http://127.0.0.1:8788/oauth/callback` を GCP に登録)。
4. nutrition write 実 grant 確認: `pnpm --filter @ghs/tools oauth:check`(200/403)。

ライセンス: 個人利用(private)。

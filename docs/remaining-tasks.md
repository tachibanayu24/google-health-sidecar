# 残タスク(運用開始後の集中バッチ / ultracode 想定)

2026-06-02 時点。M1(web PWA)+ MCP(M2, 20ツール)は実装・本番稼働済み。以下は「一旦運用に入る」段階で残した、急がない品質・整備タスク。**帰宅後 ultracode で実施想定**。

## 1. 徹底レビュー(全体)
- 3パッケージ(@ghs/core / apps/web / apps/mcp)横断のバグ・整合性・デッドコード走査。
- セキュリティ再点検(public repo 化済 — 認証情報の再確認は実施済で漏洩なし。継続監視)。
- 一方向同期・own-write 除外・冪等の境界がコード全体で一貫しているか。

## 2. リファクタリング
- 部分最適の積み重ねの解消(命名・重複・責務分割)。特に MCP の write ツールの共通化余地。
- テスト網羅の底上げ(MCP ツール層の contract テストは未整備=live curl 検証のみ。core は 90 tests)。
- probe ツール3本(`probe-datatypes` / `probe-active-energy` / `probe-sync-check`)の整理・統合。

## 3. リアーキテクチャ検討(構造)
- 同期 cadence: pageSize 拡大(1000)で軽量化し */5 高頻度化済み。GH レート/コスト実測で最終調整。
- two-worker(web/mcp)境界・共有 core の API 面の整理。
- 部位タクソノミ拡張の是非(下記 §5 の内転筋など)。

## 4. ドキュメント最新化
- `docs/design.md`: 同期 cadence 修正(3日ルックバック・pageSize 1000・毎*/5集計)、active-energy 取込、§5.4 を現状へ。
- `docs/mcp-design.md`: 実装済みカタログ(20ツール)・server instructions・sleep/sensing in get_day を反映(設計→実装の差分)。
- `README` / 図: 3者(トレーナーAI / Logbook / GH)のデータフローと運用手順を最新化。

## 5. 既知の個別残件(小)
- **hip-adduction(内転)**: adductor 筋群が `MuscleGroupId`(16筋群)に無く、追加には enum + `muscle_groups` seed + region + body-figure slug + UI マップの拡張が要る。アブダクションは glutes で近似追加済、内転は保留。
- **weighted⇒entryValue ガード**: 現状 MCP の `log_workout` 層のみ。core の `SaveWorkoutInputSchema` に入れると `.shape` 衝突 + web バリデーションへ波及するため見送り中。要設計。
- **エネルギー収支の BMR**: GH は活動分(active-energy)のみ。総消費の自前算出のため BMR(profile/設定値)を取り込むか検討(現状はトレーナーAIが推定 BMR を加算)。
- **エイリアス辞書**: 運用で引けない俗称が出たら追記(育てる)。
- **public repo の識別子**: `wrangler.jsonc` に account_id / D1・KV id / ALLOWED_EMAIL が見える(認証情報ではない)。気になれば vars/secret 化。
- **バックフィルWO**: 5/30・5/31 は tools で D1 直入れのため GH 未送(push 台帳なし)。必要なら個別 push。
- **provenance 厳密化**: get_day の当日 sensing/sleep は実際にはミラー遅延がありうるが現状一律 `d1_confirmed`。当日分を `gh_provisional`+`as_of` にするか検討。

## 参考: 完了済み(運用可)
M1 web 全画面 / MCP 20ツール(記録→分析→エネルギー収支→GH反映→取消・掃除)/ 糖質・繊維・塩の忠実 push / 種目カタログ整備 + エイリアス / 部位カレンダー・頻度(total_sets)/ 体重自動入力 / セッション自動命名 / 旧 Fitbit MCP からの完全移行可。

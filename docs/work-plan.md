# 作業計画 — 総チェック由来の10項目(2026-06-03 着手)

総チェック(`project-opportunities-review` workflow)で採択した10項目をステップバイステップで実装する進捗管理ドキュメント。
完了したら各項目を `docs/remaining-tasks.md` / `docs/design.md` に昇格し、本ファイルは役目を終える。

採択: A-1, A-2, A-3, B-4(ピッカーのみ・週送りなし), B-6, B-7, C-8, C-9, C-10, C-11
(B-5「Readiness学習中の説明」は今回見送り)

凡例: ☐ todo / ◐ in-progress / ☑ done(commit/deploy 追記)

---

## Phase 1 — 小さな堅牢化(低リスク・ウォームアップ)

- ☐ **C-10 body_metrics upsert を ON CONFLICT 統一**
  `storage.ts` の `upsertGhBodyPoint` が SELECT→UPDATE/INSERT の2段構造。daily_metrics/sleep と同じ `ON CONFLICT(gh_external_id) DO UPDATE` に統一し、重複行(先日の18.1×2のような)を構造的に防ぐ。要: body_metrics に gh_external_id の UNIQUE があるか確認。
- ☐ **C-9 save_routine の N+1 解消**
  MCP `save_routine` の exerciseId 解決がループ毎クエリ。Map キャッシュで重複解決を1回に(同一idの再解決を避ける)。`resolveExerciseId` 呼び出しを unique 集合に対してのみ実行(既に Set 化済みか確認)。
- ☐ **C-11 own-write 第2キー(gh_data_origin)のテスト**
  `isKnownOwnWrite` の datapoint_id 一致 / gh_data_origin 一致 / 空文字ガード を core テストで固める(review-findings P1#5)。

## Phase 2 — MCP read 面を厚く(最高レバレッジ・§0.5 バケツB)

- ☐ **BMR 基盤(A-1 の前提)**
  settings に身長/年齢/性別を追加 → Mifflin-St Jeor で BMR 算出する純関数(domain)。総消費 = BMR + active_energy の定義を可能に。
- ☐ **A-1 `get_nutrition_status`(適応型TDEE)**
  体重トレンド(加重移動平均)× 摂取kcal から消費を逆算。フェーズ目標レート vs 実レートのズレ。遵守ゲート(記録薄い週は出さない)。純関数 + repo + MCP read ツール。実測主義: 推定は推定明示。
- ☐ **A-3 `get_plateau_indicators`(停滞検知)**
  主要種目の e1RM 確定値を時系列で見て、同RPE帯で横ばい/低下を検出。純関数 + MCP read。デロード提案の判断材料(判定はClaude)。
- ☐ **A-2 `get_meal_recovery_correlation`(食事×回復相関)**
  過去N日の食事(PFC/塩/糖/食事時刻)× 翌朝の回復(HRV/RHR/睡眠効率)を層別クロス。**n と中央値差のみ**(因果・p値は出さない)。N不足は「発見なし」。

## Phase 3 — Web UX

- ☐ **B-4 日付ピッカー(週送りは入れない)**
  Home/各画面の日付ナビに、日付を直接選べるピッカー(`<input type="date">` ベース)を追加。長距離移動を高速化。週送りは不要との指示。
- ☐ **B-6 消費kcal(active_energy)の可視化**
  取り込み済みの active_energy_kcal を UI に。摂取×消費の収支が見える形(Home か栄養 or からだ)。
- ☐ **B-7 セット削除の見直し + ルーティン空状態ガイド**
  記録画面「最後の1セット削除不可」の制約を見直し(種目ごと削除へ誘導 or 制約緩和)。Routines 空状態に「Claude(MCP)への頼み方」ガイドを足す。

## Phase 4 — 品質保証(新ツールも対象に)

- ☐ **C-8 MCP/Web contract テスト**
  core は130 tests あるが web/mcp はゼロ。MCPツール(特に Phase2 の新ツール)と認証ゲート(timingSafeEqual/ipv4InCidr)・主要 API エンドポイントの contract を vitest で。

---

## 進捗ログ
(各完了時にコミットhash/デプロイVersion IDを追記)

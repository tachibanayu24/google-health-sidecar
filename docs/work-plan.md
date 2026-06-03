# 作業計画 — 総チェック由来の10項目(2026-06-03 着手)

総チェック(`project-opportunities-review` workflow)で採択した10項目をステップバイステップで実装する進捗管理ドキュメント。
完了したら各項目を `docs/remaining-tasks.md` / `docs/design.md` に昇格し、本ファイルは役目を終える。

採択: A-1, A-2, A-3, B-4(ピッカーのみ・週送りなし), B-6, B-7, C-8, C-9, C-10, C-11
(B-5「Readiness学習中の説明」は今回見送り)

凡例: ☐ todo / ◐ in-progress / ☑ done(commit/deploy 追記)

---

## Phase 1 — 小さな堅牢化(低リスク・ウォームアップ)✅完了

- ☑ **C-10 body_metrics upsert を ON CONFLICT 統一**
  `storage.ts upsertGhBodyPoint` を SELECT→分岐 から単一 `INSERT ... ON CONFLICT(gh_external_id) WHERE gh_external_id IS NOT NULL DO UPDATE` に(sleep と同型)。部分UNIQUEインデックス確認済。重複行を構造的に防止。
- ☑ **C-9 save_routine の N+1 解消**
  既に unique Set で重複解決は回避済だったが、さらに `getExistingExerciseIds`(新規・1クエリ)で実在id を一括判定し、名前/エイリアスのみ個別解決に。通常ケース(全部id)はDB 1クエリ。
- ☑ **C-11 own-write 第2キー(gh_data_origin)のテスト**
  既に前回レビュー対応でテスト済(782/784/791/792)だったため、「両キー無しガード」の1ケースのみ追加(計131 tests)。

## Phase 2 — MCP read 面を厚く(最高レバレッジ・§0.5 バケツB)✅完了

- ☑ **BMR 基盤** migration 0018(settings に height_cm/birth_year/sex)+ `bmrMifflin`(domain/energy.ts, Mifflin-St Jeor)。web 設定に「身体プロフィール」カード(任意入力・他設定を消さないマージ保存)。
- ☑ **A-1 `get_nutrition_status`** domain/energy.ts(`linearWeightTrend`+`computeAdaptiveTdee`)+ services/insights.ts + MCP。体重直線トレンド×摂取で TDEE 逆算。遵守ゲート(<7日/記録薄→insufficient/low)。BMR 同梱。
- ☑ **A-3 `get_plateau_indicators`** domain/training-progress.ts(`classifyE1rmTrend`)+ services/workout.ts(セッション最高e1RMの前後半比較)+ MCP。±2%帯で plateau。
- ☑ **A-2 `get_meal_recovery_correlation`** domain/nutrition-recovery.ts(`correlate`・中央値分割)+ services/insights.ts + MCP。食事×翌朝回復、n と中央値差のみ・各群n<5は非表示。
- テスト: energy 8 / training-progress 4 / nutrition-recovery 2 追加(計145)。

## Phase 3 — Web UX ✅完了

- ☑ **B-4 日付ピッカー(週送りなし)** 共有 `DateField`(中央ラベルに透明 `input[type=date]` を重ね・max=今日)を Home/からだ/食事の3ナビに適用。±1日ボタンは維持。
- ☑ **B-6 消費kcal可視化** 食事画面の kcal ヒーローに「活動消費 N kcal」(GHミラーの active_energy)を併記。摂取との収支の目安。(からだのセンシングにも既出)
- ☑ **B-7 セット削除見直し + ルーティン空状態ガイド** 記録画面: 最後の1セット削除で種目ごと除去(disabled撤廃)。Routines 空状態を具体的な頼み方の例つきカードに。
- ☑ **(追加)ルーティンの web 削除** オーナー指摘で、Routine 詳細に削除ボタン + `DeleteConfirmModal`(kind='routine')を追加(`DELETE /routines/:id`)。

## Phase 4 — 品質保証 ✅完了

- ☑ **C-8 MCP/Web contract テスト(土台)**
  MCP 認証ガードの純関数(timingSafeEqual/ipv4InCidr)を `apps/mcp/src/auth.ts` に切り出し vitest 10件。
  web は最小 vitest 設定(Cloudflare/Reactプラグイン非読込)+ lib/datetime のテスト6件(日付演算=ナビ/ピッカーの土台)。
  両アプリに `test` script を追加し `pnpm -r test` で core(145)+web(6)+mcp(10)が走る。
  **残(別タスク)**: 全MCPツール/全APIルートの網羅的 contract テストは大きいので段階的に。今回は最重要の認証境界 + 日付演算を固めた。

---

## 進捗ログ

**2026-06-03 全4フェーズ完了。** MCP 29ツール・core145/web6/mcp10 tests・全デプロイ済。
canonical docs(design.md §8.11 / mcp-design.md 29本 / README / remaining-tasks §0.1)へ昇格済。
本ファイルは記録として保持(次の作業バッチで再利用 or アーカイブ可)。

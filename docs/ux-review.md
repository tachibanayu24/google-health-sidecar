# UX 俯瞰レビュー(M1 UI, 2026-06-01)

アプリ「Logbook」の UI 全体を俯瞰し、構成と体験を評価。実装済みの改善と、今後の優先順位を残す。

## 現状の構成(良い点)

- **下部タブ5 + 中央FAB**: Today / Trends / ＋(チューザー) / Muscles / Settings。中央FABは「ワークアウト/食事」を選ぶボトムシート。モバイルの王道で迷いがない。
- **Today = ダッシュボード**: 体重・体脂肪(GH同期/出所バッジ)、記録中バナー、栄養(kcal + PFC バー + 食塩相当量<6g)、睡眠(同期後)。一目で今日が分かる。
- **データ前面のタイポ**: Archivo の大きな tabular 数字 + Hanken Grotesk 本文 + 朱アクセント。ライトのペーパー基調で「精密なトレーニング・ジャーナル」感。
- **記録の速さ**: ワークアウトは前回値プレフィル + kg/lb トグル + 集計バー。食事は meal_type チップ + 過去食オートコンプリート。
- **全write一点経由**(services)で UI/MCP/将来バッチが同じ真実に着地。

## 今回実装した改善

- **部位タップ→種目候補**(要望): ワークアウトの「種目を追加」に部位チップ(胸/広背/大腿四頭…)を追加。タップでその部位を主働/協働とする種目に絞り込み(`searchExercises` の muscle フィルタ)。テキスト検索と併用可。
  - 制約: 種目シードが現状 8 種なので、絞り込み結果は限定的。free-exercise-db 全取込(下記#2)で本領発揮。

## 完了(2026-06-01 追加)

- ✅ **#1 設定の編集**: 単位/1RM式(タップ即保存)+ 栄養目標(phase+PFC+食塩のフォーム)。
  `PATCH /api/settings`・`PUT /api/nutrition-targets`(services 経由・D1のみ)。本番検証済。
- ✅ **#2 種目マスタ拡充(第一弾)**: 定番50種(フリーウェイト+マシン、Hammer Strength 公式英語名)を
  migration 0004 で追加(計55種)。部位マッピング正確化で検索・部位フィルタが実用化。
  ※ free-exercise-db 全取込(800+)は将来の第二弾。
- ✅ **#8 PWA(アイコン+SW)**: Lucide Dumbbell アイコン一式(192/512/maskable/apple-touch)、
  最小 Service Worker(オフライン shell・/api非キャッシュ)。インストール可能。
  ※ オフライン下書き(IndexedDB アウトボックス)はリッチ化として後続。
- ✅ **#10 ログイン本番化**: Cloudflare デプロイ済(workers.dev)、GCP redirect 登録・実ログイン確認。
- ✅ **Home 化 + 日付ナビ**: Today→Home、前日/翌日ナビ、睡眠/センシング ダッシュボード、空状態整理。
- ✅ **GH 同期バグ修正**: KV LOCK TTL(30→60)・sleep ON CONFLICT(部分index述語)・steps除外。
  本番で8種(weight/body-fat/sleep/resting-hr/hrv/SpO2/呼吸/VO2max)が稼働。
- ✅ **#1 ワークアウト記録強化**: セット種別ピッカー(main/warmup/drop/failure 循環)、前回値プレフィル、
  History に最近のワークアウト一覧+削除(GH datapoint も batchDelete)。
- ✅ **#2 食事プリセット**: 保存/適用(ワンタップ)/削除。適用時に使用回数加算。
- ✅ **#3 Today/Home の食事操作**: 食事行から編集(再オープン→更新)/削除。
- ✅ **#4 筋肉SVG相互作用 + チャート**: 部位行タップ→種目一覧、種目別 e1RM 推移チャート、自己ベスト(PR)一覧。
- ✅ **GH 同期ヘルス可視化**: invalid_grant 再認証検知 + `/api/sync-status` + Home 警告バナー(黙殺防止)。
- ✅ **アーキ/堅牢性ハードニング(2026-06-01, レビュー残対応)**:
  - 冪等キー(`client_request_id`)を logMeal/saveWorkout に配線。web は per-draft UUID 送信、MCP も同 service 経由で二重登録防止(§9.8)。
  - API 書込に Zod 検証(`domain/inputs.ts` を web+MCP 共通契約に)。不正入力は 500→400+issues。
  - **push dead-letter 化**(`0007`/`0008`): retry 上限(8)or 403/401/400 で `dead_letter` 隔離、それ以外は指数バックオフ(`next_retry_at`, 上限6h)、RateLimit は retry_count 非消費で先送り。`/sync-status` に `pushQueue`、Home バナーが恒久失敗を警告。
  - **body_fat push の独立追跡**: 体重/体脂肪を別台帳行(`body_metric_fat`)・別 try/catch に分離(旧: 体脂肪失敗が体重 synced を巻き戻し→体重二重 push する不具合を修正)。
  - own-write echo 判定(`isKnownOwnWrite`)の空 origin 誤一致を防止・併用根拠を明文化。
  - N+1 解消(meal_items / exercise_muscles を IN 一括取得)。
  - UI 仕上げ: プリセット保存をボトムシート化(window.prompt 廃止)・合計 kcal 別格・セット種別凡例・離脱破棄ガード・部位図の近似注記。
  - テスト 39→62件(Zod スキーマ + better-sqlite3 で D1 互換の service 統合テスト: 冪等/原子性/CASCADE/dead-letter)。
- ✅ **ワークアウト強化2**: 種目並べ替え(↑↓)/ 過去セッション in-place 編集(History鉛筆)。
  ※ スーパーセット連結UIはオーナー判断で後に削除(下記 2026-06-01 整理)。
- ✅ **skin-temp / steps の恒久除外を実機プローブで確定**(GH未提供 / 日次型なし)。
- ✅ **記録体験の簡素化 + 日時/オフライン(2026-06-01)**:
  - セット種別を「本番 / ウォームアップ」の2状態に簡素化(M/D/F/AMRAP/backoff 廃止)。総量・PR は warmup 除外を維持。
  - スーパーセット連結UI(鎖アイコン/SSバッジ)を削除(数値計算に無関係・操作を簡素化)。並べ替え↑↓・削除は維持。
  - ワークアウト**登録日時を編集可能**に(`datetime-local`, デフォルト現在時刻, 過去セッション遡及記録可)。
  - **dayjs(+utc/timezone)** 導入で UI の JST 日付処理を一本化(`lib/datetime.ts`)。core の `util/date` は据え置き。
  - **PWA オフライン送信キュー実装**(`lib/outbox.ts`): ネット不通かつ `client_request_id` 有りで食事/ワークアウトを IndexedDB 退避→online/前面復帰/起動時に自動再送(server 冪等で二重登録なし)。Home に未送信バナー+今すぐ送信。dead-letter は 4xx破棄/5xx上限。
- ✅ **ログUXゼロベース再設計(2026-06-01, 設計WF→実装→多面レビュー)**:
  - **食事**: meal_type 別グルーピング(朝/昼/夕/間食)。カテゴリ見出しに小計kcal、展開で**品目別 P/F/C**、カテゴリ計フッター。主要3食初期展開。API変更なし(クライアント集計)。
  - **ワークアウト**: History の各セッションを**展開で読み取り表示**(編集に入らず種目×セット/W バッジ/RPE が見える)。`getWorkout` を `enabled:open` で遅延フェッチ、最新1件初期展開、失敗時はエラー+再試行。
  - **削除確認モーダル**: 共通 `DeleteConfirmModal`(食事/ワークアウト)。インラインのタップ確認を廃止。常に閉じられ(固まらない)、確定ボタンのみ pending 中 disabled で二重実行防止。
  - 多面 adversarial レビュー(6観点→検証)で確証バグ7件のうち本物のみ修正。

## オーナー判断で不採用(2026-06-01)
- ❌ **進捗写真(R2)** — 不要。
- ❌ **食事写真入力UI** — 不要(写真からの栄養計算は将来 MCP 側で検討)。
- ❌ **身体周径(body_measurements)** — 不要。実装分は revert 済(`3d4e146`)。

## 今後の UX 改善(採用分・優先順)
1. **品質・運用(CI除く)**: D1バックアップ・KV監視・ALLOWED_SUB・PKCE。
2. **PWA インストール導線バナー**(Android `beforeinstallprompt` / iOS 案内)。
   - ※ オフライン送信キュー(IndexedDB アウトボックス)・歩数日次集計・service層テスト・Zod は導入済。
   - ※ オフライン**閲覧**(/api レスポンスのキャッシュ)は現状非対応(書込の取りこぼし防止を優先)。必要なら別途。

### 不採用(オーナー判断, 2026-06-01)
- ❌ ワークアウトテンプレート(PPL) / ❌ 種目図鑑(free-exercise-db 800+) / ❌ 進捗写真 / ❌ 食事写真入力 / ❌ 身体周径

### 後回し
- **MCP / AI**: web+GH が固まってから(Claude 経由の記録・読取, 別フェーズ)。

## 体験の芯(維持すべき原則)

- 記録は**最小タップ**(前回値・オートコンプリート・チューザー)。
- 数字は**大きく tabular**、単位は kg/lb 両表示・食塩相当量は g。
- センシング(体重/睡眠)は**表示専用**、authoring(食事/ワークアウト)は**このアプリが真実**。

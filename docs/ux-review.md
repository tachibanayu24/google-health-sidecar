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
- ✅ **情報設計(IA)ゼロベース再構成(2026-06-01, ベンチマークWF→実装→多面レビュー)**:
  「1画面に詰め込みすぎ」をボトムナビ+画面責務から解消。各画面を単一責務に。API変更ゼロ。
  - ボトムナビ5枠: **ホーム / トレーニング(Dumbbell) / ＋記録 / からだ(HeartPulse) / 設定**。旧「推移」「部位」を廃止しトレーニングへ統合、「からだ」を新設。
  - **ホーム**(`Home.tsx`)= 当日のグランスに徹する。BodyStrip + 記録中 + 栄養/トレ/回復の各 Glance([詳細›]で専用画面へ)。DateNav は撤去(常に当日)し詰め込み排除。
  - **栄養**(`Nutrition.tsx`, サブ画面)= kcal残ヒーロー + マクロ + 食事ログ(品目別)+ 記録/目標導線 + 日付ステッパー(過去日の振り返り)。
  - **トレーニング**(`Training.tsx`)= Performance + 筋ヒートマップ + タブ〔ワークアウト(最近WO読取+PR)/ ボリューム(日次bar+部位別)/ 種目(e1RM推移)〕。
  - **からだ**(`Recovery.tsx`)= 週間スナップショット + 体組成90日(体重+体脂肪 dual line)+ 体重手入力 + 睡眠の質 + 日次センシング。
  - 共通化: `components/state.tsx`(Loading/ErrorBox/Empty)・`components/chart.tsx`(ChartFrame/TT/色)。旧 History.tsx/Muscle.tsx 削除。
  - 多面 adversarial レビュー(5観点→検証)で確証バグ6件を修正(Home日付不整合・読取エラー無音・recharts domain・編集戻り先 等)。
- ✅ **実ルーティング + ドリルダウンUX(2026-06-01)**:
  - **react-router-dom(createBrowserRouter)へ移行**。「ブラウザバックでアプリが落ちる」(useState 切替で履歴なし)を根治。実URL(/training /body /nutrition /nutrition/:type /record/:id /meal/:id)+ back/forward + ディープリンク(wrangler SPA fallback 既設, 全ルート 200 確認)。離脱破棄ガードは `useBlocker` 化、保存後は `navigate(-1)` で元画面へ。
  - **食事→マクロレーダー詳細**(`MealCategoryDetail.tsx`): 栄養画面は区分サマリ一覧、各区分タップで詳細へ。マクロを **P/F/C のカロリー寄与% でレーダーチャート**可視化 + 品目別内訳 + 編集/削除。「タップ→可視化付き詳細」を体験の芯に。
  - 栄養の日付は **URL(?d=)単一ソース**化(内部 state drift を解消, `{replace}` で履歴を汚さない)。
  - 焦点 adversarial レビュー(3観点→検証)で確証バグ1件(日付 drift)を修正。
- ✅ **可視化システム統一 + データUI仕上げ(2026-06-02, オーナーFB反映)**:
  - **マクロ可視化をバーに一本化**: 共通 `NutrientBars`(P/F/C/塩/繊維, 対目標%)を新設し全画面で統一。MealCategoryDetail のレーダーを撤去 → 同一対象でのレーダー/バー混在を根絶。塩=超過のみ警告色、繊維=未捕捉時グレー、`--color-fiber` トークン追加。
  - **食塩・食物繊維のデータ配線**: target_fiber_g(migration 0009)・/today pfc 集計・型・autocomplete・Meal入力(6列)・設定目標。食物繊維は GH の food log に実在(確認済)だが既存486件は初回バックフィルで取りこぼし → **バックフィルはせず運用以降で蓄積**(オーナー方針)。
  - **からだ画面の目的を明確化**: ①体組成(週次/月次 変化ペース+除脂肪量+90日 dual line)②回復(睡眠+HRV+安静時心拍を1枚)③日次センシング。「計画通りか/回復できてるか」の2問に答えるダッシュボードへ。
  - **Home に日付ナビ復活**(各グランスを選択日に整合)。**種目名は英語表示に統一**(ja併記廃止)。**セット種別=本番チェックボックス**(チェック=総量/PR計上)。
  - **モーダル共通化**: `components/Overlay`(Modal/Sheet, body へ portal)。`.rise`(transform)による fixed 破綻=オーバーレイが全画面を覆わない不具合を一元解消(DeleteConfirm/DiscardGuard/LogChooser/WeightLogger/PresetSaveSheet を全置換)。
- ✅ **ゼロベース品質リファクタ(2026-06-02, 監査WF 37件→安全分実行)**:
  - 共有lib集約: `lib/datetime`(shiftDate/formatDateForDisplay)・`lib/invalidate`(invalidateMeals/Workouts/Body/Settings/AfterFlush)で散在ロジックをDRY化。
  - 死蔵除去: getExerciseMuscles・BodyMeasurement型・supersetGroup契約(DB列は legacy 保持)。
  - 型安全: プリセット items_json を safeParse(MealItemInputSchema を core に抽出・共有)。
  - perf: recharts/react-body-highlighter を **code-split**(初期バンドル 880KB→405KB、recharts は該当画面訪問時のみ)。
  - テスト: util/date の JST境界テスト追加(62→71)。
  - 監査で**意図的に見送った項目**(理由付き): name_ja列drop(検索が利用)・sugar除去(表示要望あり・配線維持)・SetType enum 縮小(metrics/PrBasis/テストへ波及)・query-key 文字列の全面集中管理(churn過大・invalidateは集約済)・core barrel 縮小(import波及)。

## オーナー判断で不採用(2026-06-01)
- ❌ **進捗写真(R2)** — 不要。
- ❌ **食事写真入力UI** — 不要(写真からの栄養計算は将来 MCP 側で検討)。
- ❌ **身体周径(body_measurements)** — 不要。実装分は revert 済(`3d4e146`)。

## 今後の残タスク(2026-06-02 時点・優先順)
1. **消費カロリー・活動量の取り込み(オーナー希望・最重要)**: GH reconcile に energy 系 dataType(総消費/活動カロリー/距離/アクティブ分/心拍ゾーン)を追加 → 保存 → **エネルギー収支(摂取 vs 消費)**を可視化。GH dataType ID の実機検証を含むサーバ拡張。`get_daily_summary` には実在(例 5/31 caloriesOut 3115)。
2. **皮膚温の取り込み**: Fitbit MCP に実在(夜間相対delta)。からだ画面の回復指標に追加。GH reconcile 経路で取れるか要検証。
3. **糖質(sugar)の表示**: 入力配線は維持済。per-food は GH food log に無く daily のみ。手入力での捕捉UI + 表示を検討(優先度低)。
4. **品質・運用(CI除く)**: D1バックアップ・KV監視・ALLOWED_SUB・PKCE。
5. **(任意)サービス層テスト拡充**: logWeight / runDailyPull(own-write除外) / retryPendingPushes の統合テスト(監査 #5/#6)。
   - ※ IA再構成・ログUX再設計・可視化統一・モーダル共通化・実ルーティング・オフライン送信キュー・歩数日次集計・code-split は導入済。
   - ❌ PWA インストール導線バナー / 進捗写真 / 食事写真入力 / 身体周径: オーナー判断で不要。
   - ※ オフライン**閲覧**(/api キャッシュ)・履歴バックフィルは非対応(運用以降のデータ蓄積を優先)。
   - ※ HRV/安静時心拍の「7日推移ライン」は専用API未整備のため当日値表示に留め(からだ画面)。必要なら /trends 拡張で段階導入。

### 不採用(オーナー判断, 2026-06-01)
- ❌ ワークアウトテンプレート(PPL) / ❌ 種目図鑑(free-exercise-db 800+) / ❌ 進捗写真 / ❌ 食事写真入力 / ❌ 身体周径

### 後回し
- **MCP / AI**: web+GH が固まってから(Claude 経由の記録・読取, 別フェーズ)。

## 体験の芯(維持すべき原則)

- 記録は**最小タップ**(前回値・オートコンプリート・チューザー)。
- 数字は**大きく tabular**、単位は kg/lb 両表示・食塩相当量は g。
- センシング(体重/睡眠)は**表示専用**、authoring(食事/ワークアウト)は**このアプリが真実**。

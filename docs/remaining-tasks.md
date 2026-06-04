# 残タスク(運用開始後の集中バッチ / ultracode 想定)

2026-06-02 時点。M1(web PWA)+ MCP(M2, 20ツール)は実装・本番稼働済み。以下は「一旦運用に入る」段階で残した、急がない品質・整備タスク。

> 💡 **機能拡張のアイデアストックは [`docs/enhancements.md`](./enhancements.md)**(横断リサーチ由来・17案 + 簡単設計)。着手時はそこから本ファイルへ移し、設計を design.md に昇格させる。

## 0. 集中バッチ実施結果(2026-06-02 ultracode)

徹底レビュー(workflow, 6次元 + 敵対的検証)→ `docs/review-findings.md`(P0:0 / P1:5 / P2:30 / 却下15)。確定分を triage して反映:

**修正済(コード)**
- inline GH push のワークアウト displayName が自動命名 title を無視し 'Workout' 固定だった → 導出 title を使用(retry/D1 と一致, `workout.ts`)。
- `get_recent_prs` が `is_provisional` を返さず説明と矛盾 → SELECT/型/MCP description 修正(`workouts.ts`/`api.ts`/`mcp index.ts`)。
- `getMuscleVolume` の窓が windowDays+1 日(週次ターゲット比が約1日過大)→ `jstDaysAgo(windowDays-1)` で `getMuscleCalendar` と規約統一。
- `get_day` のワークアウト取得が `getRecentSessions(50)` 依存で古い日付を取りこぼし得た → `getSessionsByDate(date)` を追加して使用。
- cron の `staleAbandonedSessions`/`runDailyPull` が throw すると push 再送までスキップ → 各段を個別 `.catch` で隔離。
- デッドコード削除: `routes.ts` の同一分岐 if/else 統合、未使用 `fmtKg`/`LB_PER_KG`。

**テスト追加(105 件 green, +15)**: retryPendingPushes の workout/body_metric 再送 + RateLimit→deferred / 403→dead_letter 分類、deleteWorkout/deleteMeal の GH delete 分岐(type 取り違え検出)、isKnownOwnWrite の gh_data_origin 第2キー + 空文字ガード、mappers の body-fat/active-energy 抽出、e1RM 境界(12/13・loadKg<=0)、recencyDecay/estStrengthCaloriesKcal。

**docs 最新化**: `design.md`(MANUAL→ACTIVELY_MEASURED・pageSize 1000・3日ルックバック・skin-temp 恒久除外・active_energy_kcal)、`mcp-design.md`(実装ステータス20ツール/get_day/delete weight/aliases/server instructions)、`README.md`(GH・MCP 接続済、active-energy 配線、22表)。

**見送り(判断つき・実害なし)**
- 塩↔ナトリウム換算 / 部位 slug / `mmdd` の重複統合: いずれも複数の web UI 画面が依存。並行 UI リデザインと衝突するため、UI 確定後に core へ集約。係数 2.54 は全箇所一致で現状バグ無し。
- `apps/mcp` / `apps/web` の vitest 新規基盤(timingSafeEqual/ipv4InCidr 純関数・認証ゲート 401/403): 認証境界は fail-closed で稼働中。予防的価値が中心のため別途。
- 食事編集のオフライン退避(delete 成功後 re-log がネット不通だと旧データ喪失): online→途中切断の狭い race。編集を冪等1オペとして outbox 化する設計が要るため別タスク。
- `active_energy_kcal` の Recovery 画面表示 / `MUSCLE_GROUPS.region` 未使用フィールド削除: UI リデザイン側へ申し送り。
- 却下 15 件(sleep startAt 未来時刻・IPv6 allowlist 素通り・URL secret・JWT alg 等)は `review-findings.md` 末尾に理由記載。再提起しない。

## 0.1 機能拡張の着手・完了(enhancements.md から移動)

- **食事スコアリング(マクロ目標適合度・レーダー)** — ✅実装・稼働(2026-06-04)。設計+トレーナーAIレビュー反映は `docs/nutrition-scoring-design.md`。1日全体+カテゴリ別(朝昼夕・間食除く)を P/脂質/糖質/繊維/塩分の5軸×目標適合度で 0..1 採点(台形バンド=下限/上限/山型・非対称ペナルティ・phase×scope加重・加重幾何平均・欠損は—で除外・収支致命軸ゲート)。カロリーは軸でなく収支ゲート+実数。**質(脂質の質/GI・GL/食事の質)は採点不能=実測で持たないため未採点**、`get_nutrition_score` は食品名を返し**トレーナーAIが会話で質を判断**(§8)。MCP 30本目 + web 食事画面レーダー(1日/朝昼夕トグル・理想輪郭・画像エクスポート)。**残**: 脂質/たんぱく質の質をAIが主観ラベルで採点組込は future work(設計書§10・今はやらない)。

- **エネルギー収支の可視化 + Home 状態ファースト再構成** — ✅(2026-06-03)。食事画面とHomeに「収支(推定)= 摂取 −(BMR+活動消費)」を表示(BMRは身体プロフィール×Mifflin、`lib/energy.ts` 共通)。Home は 体組成→**コンディション(Readiness信号を昇格)**→栄養(収支統合)→トレーニング の順に再構成。MCP server instructions も維持カロリー=get_nutrition_status 優先に更新。design.md §8.11。
- **総チェック由来10項目(work-plan.md)** — ✅完了(2026-06-03)。Phase1 堅牢化(body_metrics upsert統一/save_routine N+1/own-write test)、Phase2 MCP高レバレッジ(適応型TDEE+BMR基盤/停滞検知/食事×回復相関, design.md §8.11)、Phase3 Web UX(日付ピッカー/消費kcal併記/セット削除見直し/ルーティンweb削除)、Phase4 品質(MCP auth + web datetime の contract テスト)。MCP 29ツール。**残**: 全MCPツール/全APIルートの網羅的 contract テストは段階的に(今回は認証境界+日付演算を固めた)。詳細は `docs/work-plan.md`。

- **トレーニングルーティン(AI作成・参照専用)** — ✅実装・デプロイ済(2026-06-03)。design.md §8.10。migration 0017(routines/routine_days/routine_exercises、種目は exercises FK 必須)。MCP 4本(get_routines/get_routine/save_routine(upsert)/delete_routine)で AI が CRUD、Web `/routines` は参照専用(各日 人体図+種目リスト・運用ルール・画像エクスポート)。役割分担=MCP authoring / Web viewer。**残**: セット範囲は min/max 保持だが人体図集計は代表値(sets_max)を使用。種目がカタログに無い場合は AI が追加できない(カタログ拡張は別途)。MCPツール計26本。
- **Readiness(④個人ベースライン基盤 + ⑤信号 + `get_readiness` MCP)** — ✅実装・デプロイ済(2026-06-03)。設計は design.md §8.8 に昇格。中核=夜間HRV(ln→7日ローリング平均)+補助/文脈指標、中央値±MAD の robust z、N-of-M 統合(偽スコア不使用)、学習ゲート14日。からだ画面に「コンディション」カード + MCP `get_readiness`。横断文献調査(11エージェント workflow・反証検証)に基づく。v1 簡略化=呼吸数/皮膚温の2晩連続ゲート未実装(N-of-M で単発は黄止まり)。
- **ボリュームランドマーク(⑧)+ 急性/慢性比(⑨)** — ✅実装・デプロイ済(2026-06-03)。design.md §8.9。migration 0016 で MEV/MAV/MRV を RP/Israetel 由来でシード(ガイドライン明示・obliques/lower_back は帯なし)。`get_muscle_volume` に `landmark_zone`、`get_readiness` に `muscleLoad`(急性/慢性比=記述指標, ACWR怪我予測は否定済ゆえ看板を外した)。Training に帯バー。**残: セット数が間接関与も1計上 → 将来 contribution 加重の「実効セット」を別オプションで出す余地**(§5 既知残件と関連)。
- **構造再編** — ✅(2026-06-03)からだ=日付切替の表示専用ダッシュボード化、体組成はホームのミニグラフ(軽量SVG)、体重記録は中央+ボタンへ集約。
- **体組成ログのweb削除 + からだ「その日の測定ログ」 + Home 2ライン化** — ✅(2026-06-03)。からだ=その日の体重/体脂肪測定を時刻・出所つきで一覧+削除(`/body-log`・`DELETE /body-metrics/:id`→`deleteBodyMetric`)。Home ミニグラフは体重+体脂肪の2ライン(独立正規化・太線)。関心分離=からだ:その日/Home:期間。
- **【既知の制約・実装しない判断】GH→D1 の削除非同期** — GH側でデータポイントを消してもD1ミラーは自動削除されない(pullはupsert専用・tombstone非対応)。エッジケースのため自動同期は実装しない方針(2026-06-03 オーナー判断)。当面はweb/MCPの削除でD1から手動除去(app-push分はGHにも伝播)。
- **セット削除** — ✅(2026-06-03)記録画面のセット行に削除ボタン追加。

以下は当初からの整備タスク(一部は §0 で対応済)。

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
- **`get_muscle_volume` の primary-only 集計オプション(将来候補)**: ロウ系の二頭など secondary(0.5)寄与が「直接ワーク」を見えにくくする懸念に対し、contribution の重み(3段階 1.0/0.5/0.25)は据え置きのまま、集計の見せ方で「主働のみ」を別途出すオプション。実運用で必要が出たら追加(現状は不要)。
- **マシン tare(始動抵抗/台自重)= 意図的に非モデル化【決定 2026-06-02】**: ハックスクワット/レッグプレスの台自重・アイソラテラル機のアーム自重を種目マスタに持たない。理由: ①同一マシン継続使用なら tare は定数で**進捗追跡(相対比較)に無関係** ②機種でばらつく値を入れる=**実測でない捏造値**でデータ品質をむしろ下げる ③マシン絶対負荷はレバレッジで元々フリーウェイト非互換。必要になったら「汎用デフォルト」ではなく**オーナーが実測 tare を opt-in 設定**する方式で(`tare_kg` 等)。運用上はハック/レッグプレスを 0 でなく実効重量で記録すればボリュームが 0 にならない。

## 参考: 完了済み(運用可)
M1 web 全画面 / MCP 20ツール(記録→分析→エネルギー収支→GH反映→取消・掃除)/ 糖質・繊維・塩の忠実 push / 種目カタログ整備 + エイリアス / 部位カレンダー・頻度(total_sets)/ 体重自動入力 / セッション自動命名 / 旧 Fitbit MCP からの完全移行可。

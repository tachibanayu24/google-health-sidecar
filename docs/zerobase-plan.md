# 設計書: ゼロベース改善計画(2026-06-05 着手)

ゼロベースのアプリ全体レビュー(`ghs-zerobase-review` workflow / 61エージェント・46提案を単一ユーザー前提で敵対的検証し38件採択)に、オーナーの4決定を反映した実装計画。
完了した項目は `docs/design.md` / `docs/mcp-design.md` / `docs/enhancements.md` に昇格し、本ファイルは役目を終える。

> **実装ステータス(2026-06-08 パス1, ブランチ `design/zerobase-improvement-plan` → main)**
> - **出荷済み**: P0 全6項目 + P1-3 + skin_temp 訂正。関連 docs(design.md / mcp-design.md / CLAUDE.md / README.md)へ昇格済み。core/web/mcp の typecheck・test・lint 全通過。
> - **P2 のモート系は却下/保留**(オーナー判断): 周径(P2-2)・血液検査(P2-4)・主観コンディション(P2-5)・AI永続メモリ(P2-6)は**実データ運用が立つ前に投機的なスキーマを切らない**方針で見送り。
> - **skin_temp(P2-3)は実装不要だった**: 調査の結果すでに `daily-sleep-temperature-derivations` で取込配線済み(2026-06-03 正ID訂正時に実装済)。本パスは docs の旧「恒久除外」記述を実態に訂正したのみ。
> - **次パス送り(余力で)**: P1-1/P1-2(skipped backfill・同期カバレッジ監査)、P2-1(charter の design.md §0 昇格)、P3 全項目(整地)。本パス未着手。
> - P0-6 の「§12.5→§12.3 相互参照ズレ」は現行 design.md に §12.3 参照が見当たらず、該当ズレなしと判断(P0-6 はバックアップ記述の訂正のみ実施)。

> 位置づけ: 本計画は「直すべき粗」のリストではない。コードの完成度は既に高い(Readiness の頑健統計、MCP の echo+confirm/冪等/`ghPushed` 正直契約、単一書き込みパス、オフライン outbox)。狙いは **設計の重心(charter)を宣言し直し、それに沿って優先順位を並べ替える**こと。

---

## 0. Charter(North Star)— このアプリは何か

**Logbook = LLMトレーナー(Claude over MCP)を一次クライアントとする「身体メモリ + 決定的計算 + アクチュエーション層」**。スタンドアロンのトラッカーではない。

- **D1 が唯一の代替不能資産**。Google Health が構造的に保持できない多年度の縦断的(訓練・栄養・身体)記録。GH からは再構築できない。
- アプリの仕事は3つに尽きる:
  1. **取り込み(ingest)**: オーナーの現実をサイレントロスゼロで取り込む。
  2. **計算(compute)**: 決定的で正直にラベルした派生指標を計算し、**MCP の read 面に全部露出**する(实测主义=測定値を出す。合成判定・処方は出さない。陳腐化したら無効化する)。判断と語りは Claude がやる。
  3. **アクチュエート(actuate)**: Claude にできない方向に作用する。
- **PWA は capture / glance / celebrate に意図的に限定**。アプリ内でコーチングを生成しない(「脚をやれ/デロードせよ」は §0.5 が Claude に割当)。

### 0.1 オーナー確定事項(本計画の前提・2026-06-05)

| # | 決定 | 計画への反映 |
|---|---|---|
| D1 | **通知(プロアクティブ outbound)は作らない** | 通知層・「凍結を大音量で知らせる」を不採用。失敗検知は**アプリ内バナーのみ**に縮小。 |
| D2 | **体重は UI で手入力しない**(GH 吸い上げ運用で足りている) | 「オフライン体重記録の堅牢化」を不採用。MCP `log_weight`(会話入力)は残すが投資しない。 |
| D3 | **GH に栄養は必須** | `FEATURE_GH_NUTRITION_PUSH=true` を確定維持。栄養 push を削る案は永久却下。 |
| D4 | **GH と同期できるデータは全部 GH に同期する。GH で扱えないデータのみこのアプリで持つ** | (a) GH 同期の**網羅性**を上げる(P1)。(b) GH 非対応データ(周径・血液検査・主観)を自前で持つ=**モートの主役**(P2)。 |

> D4 の含意: 現状の役割分担は既にこの原則をほぼ体現している(ワークアウトのセット粒度は GH に schema が無いため自前で正しい、栄養・体重・運動セッションは GH に push)。本計画はその原則を **charter として明文化**し、抜け(未同期 / 未活用の自前データ)を埋める。

### 0.2 トリアージ規則(バックログの並べ替え基準)

> 新しい分析・計算は、既定で **core のドメイン関数 → MCP read ツール**として出す。PWA ビューを足すのは capture / glance / celebrate に資するときだけ。色・ラベルの見た目調整は機会的にのみ行い、決して主軸にしない。

---

## 1. 凡例

`☐ todo / ◐ in-progress / ☑ done`(完了時に commit/deploy を追記)。工数: `S`(数行〜半日)/ `M`(1〜数日)/ `L`(週単位)。

---

## 2. Phase P0 — 数値・契約の嘘を止める(最優先)

Claude が全 read/write 戻り値の一次消費者。**嘘の戻り値 = Claude のデータ可視性の損失**であり、誤った数値は実プログラミング判断を誤らせる。全て core で直すため web も自動で恩恵を受ける。

- ☑ **P0-1 landmark_zone の林檎対オレンジ比較を修正** `S`(出荷: `effective_sets` 新設→landmark_zone/vs_target の基準に。getMuscleLoadRatios は ACWR=比指標ゆえ据え置き)
  - 現象: `getMuscleVolume` / `getMuscleLoadRatios` は secondary/stabilizer リンクを**各1フル直接セット**として数える(`workout-analytics.ts:110` `a.sets += 1`、`:172` `a.chronic += 1`)のに、それを**直接セット基準**の MEV/MAV/MRV バンドと比較している(`:135` `volumeLandmarkZone(a.sets, landmarks)`)。結果、複合種目の多い三頭・前三角が偽「optimal/over」と出て、**直接腕トレを飛ばす**実害を誘発。
  - 修正: contribution 加重の `effective_sets = Σ link.contribution`(volume/stimulus は既に `:111-112` で加重済みなので一貫させるだけ)を新設し、**`landmark_zone` には `effective_sets` を渡す**。`actual_sets`(間接含む素のセット数)は表示用に**据え置き**(破壊的変更を避ける)。`getMuscleLoadRatios` の `chronic/acute` も同様に effective 化するか、ACWR は記述指標なので素のままにするかを設計判断(揃えるなら effective)。
  - 同梱必須(CLAUDE.md「嘘をつくと Claude がデータ可視性を失う」規約): 横断参照する**ツール記述 ~5本を書き換え**(`apps/mcp/src/index.ts:219, 237, 251, 317, 411`)+ `docs/design.md` §8.9 周辺 + `docs/enhancements.md`。
  - 参照: `packages/core/src/services/workout-analytics.ts:101-143, 159-191`、`packages/core/src/domain/volume-landmarks.ts`。

- ☑ **P0-2 冪等再送の戻り値が嘘をつくのを直す** `S`(出荷: `idempotentHit` 追加 + workout は実値 totalVolumeKg/title 再読込)
  - 現象: 同一 `client_request_id` の再送が `totalVolumeKg:0 / newPrs:[] / title:null` を返し(`workout-write.ts:74-82`)、本物の空セッションと区別不能。MCP 記述が「再送結果から『PRなし』と判断するな」と防御を要求している=実装詳細が契約に漏れている。
  - 修正: dedup ヒット時は既存 `sessionId` から**真の永続化サマリを再読込して返す**。加えて機械可読な `idempotentHit: boolean` を返り値に追加(`!ghPushed` での暗黙エンコードは捨てる)。`logMeal` / `logMealFromPreset` も同様。`log_weight` は対象外(crid 無し・soft-guard で別管理)。
  - 参照: `packages/core/src/services/workout-write.ts:74-82`、`packages/core/src/services/nutrition.ts`。

- ☑ **P0-3 同日ミラー遅延 sensing の provenance を正直に** `S`(出荷: get_day/get_readiness に `sensingProvenance`=当日 gh_provisional。gh_auth_error は P1-3 バナーへ委譲)
  - 現象: `get_day` / `get_readiness` が当日の Fitbit→GH ミラー未到達データも一律 `provenance:'d1_confirmed'` で返すため、Claude が「今日の HRV は欠損」を**権威的事実**として断言してしまう。
  - 修正: 当日(または直近で未確定)のセンシング/睡眠に `gh_provisional`(ミラー遅延で暫定/未到達)を付す。GH トークン失効時は `gh_auth_error`。**`get_day` / `get_readiness` の sensing 部分にだけスコープ**(全 read への 4タプル付与は過剰なので**しない**)。
  - 参照: `apps/mcp/src/index.ts`(`get_day`/`get_readiness`)、`packages/core/src/services/insights.ts` / `readiness` repository。

- ☑ **P0-4 flushOutbox の恒久失敗サイレント削除を止める** `S`(出荷: `failed:true` 保持 + retry スキップ + OutboxBanner に再送/削除。分類を純関数 `classifyFlush` 化しテスト追加)
  - 現象: 4xx / 試行上限超で `remove()` して**サイレントに破棄**(`outbox.ts:114-128`)、ユーザーは件数カウンタしか見えない。食事・ワークアウトは authoring=真実なので、消えると真実が消える。
  - 修正: 恒久失敗は削除せず `failed:true` で IDB に残し、retry ではスキップ。`OutboxBanner` に「N件の記録を送信できませんでした」+ 各アイテムの**再送/削除**操作を出す。
  - 参照: `apps/web/src/ui/lib/outbox.ts:95-139`、`apps/web/src/ui/screens/Home.tsx`(`OutboxBanner`)。

- ☑ **P0-5 delete の GH/D1 順序を入れ替える** `S`(出荷: deleteWorkout/deleteMeal/deleteBodyMetric を D1 batch 先・GH batchDelete 後に)
  - 現象: `deleteMeal` / `deleteWorkout` / `deleteBodyMetric` が **GH delete を D1 batch より先**に実行。GH delete 成功後・D1 batch 前にプロセスが死ぬと、D1 行は残るが GH からは消えた=検出困難な false-synced 状態。
  - 修正: **D1 `runBatch` を先**、その後 best-effort で GH `batchDelete`(`gh_datapoint_id` は batch 前に取得済み)。これで失敗は `design.md` 記載の「許容済み orphaned GH datapoint」(upsert-only でいずれ無害)に倒れる。
  - 参照: `packages/core/src/services/nutrition.ts:229-245`、`workout-write.ts:361-388`、`body.ts:102-122`。

- ☑ **P0-6 `design.md §12.6` の偽バックアップ記述を修正** `S`(コード0行。GH はワークアウトをトップセット notes 要約のみ保持=退避先に過信しない旨へ訂正)
  - 現象: 「GH push がバックアップとして残る」は**事実誤り**。GH はワークアウトを**トップセットの notes 要約**でしか持たず(セット粒度なし)、栄養はフラグ依存。D4 で GH 同期を重視する以上、**GH が実際に何を保持するか**を正確に書き、退避先として過信させない。
  - 参照: `docs/design.md §12.6`、§7 の §12.5→§12.3 相互参照ズレも同時に修正。

---

## 3. Phase P1 — GH 同期の網羅性(D4「同期できるものは全部」)

- ☐ **P1-1 `skipped_flag_off` の backfill 経路** `S〜M`
  - 現象: `FEATURE_GH_NUTRITION_PUSH=false` の期間に記録した食事は `skipped_flag_off`(終端)になり、フラグ ON 後も**自動再送されない**(`nutrition.ts:101`、`sync.ts:206`)。栄養は GH 必須(D3)なので、この乖離は埋める。
  - 修正: 「skipped を pending に戻す」一発の admin 経路(`tools` の tsx か `retryPendingPushes` 拡張)。本番は既に `true` なので、対象は主に**過去分の一度きり backfill**。恒久ツール化はせず、最小の requeue で足りる。
  - 参照: `packages/core/src/services/sync.ts`、`packages/core/src/db/repositories/sync.ts`。

- ☐ **P1-2 GH 同期カバレッジ監査** `S`
  - 現状 push 対象 = `workout` / `meal` / `body_metric`。GH が保持できるのに未同期の authoring データが無いか棚卸し(セット粒度・主観・周径は GH 非対応=自前で正しい、を確認して台帳化)。結果を `docs/design.md §2` の系統表に明記。

- ☑ **P1-3 凍結 cron のアプリ内検知(通知なし・バナーのみ)** `S`(出荷: /sync-status に `staleMinutes`。SyncHealthBanner が6時間超×JST起床帯のみ「最終同期がN時間前」を表示)
  - 現象: 体重・センシングを全て GH 吸い上げ(pull)に依存する(D2)以上、cron 停止 = 身体データが静かに止まる。だが `SyncHealthBanner` は `consecutive_failures` しか見ず、**凍結を健全と見分けられない**。
  - 修正: `/api/sync-status` に `staleMinutes = now - max(last_synced_at)`(取得済み行への MAX 一発)を足し、`SyncHealthBanner` を「最終同期が N時間前 — cron 停止の可能性」で分岐。JST 起床時間帯に限定して夜間の静寂で誤発火させない。**通知はしない(D1)**。
  - 参照: `apps/web/src/api/routes.ts`、`apps/web/src/ui/screens/Home.tsx`(`SyncHealthBanner`)。

---

## 4. Phase P2 — モート: GH で扱えないデータ(D4 の核心・戦略の主役)

「トレーナーが今盲目で、それがあれば助言が変わるデータ」を取り込む。GH が構造的に持てないデータ = このアプリの存在理由。各スライスは独立出荷可能。**新規ナビ面は作らず**既存画面に間借りする。

- ☐ **P2-1 Charter 昇格 + トリアージ規則の明文化** `S`
  - `docs/enhancements.md §0.5`「アプリ=最高の文脈プロバイダ」の thesis を `docs/design.md §0` 冒頭の charter に昇格。§0.1/§0.2(本書)の4決定とトリアージ規則を併記。これが他全項目の優先順位を自動で決める安価なメタ手。**再 charter・既存分析表示の削除はしない**(既存の分析表示は §0.5 準拠の glance であってアプリ生成コーチングではない)。

- ☐ **P2-2 周径(circumference)の起動** `M`(マイグレーション不要)
  - `body_measurements` テーブルは migration 0001(L235-243)に存在し**100%休眠**(service/MCP/UI 配線ゼロ)。フィジーク競技者にとって GH が持てない一級データ。最初の測定が入った日に価値が出る最安スライス。
  - 実装: `body.ts` に `logWeight` 隣の `saveBodyMeasurement`(左右は `site` 規約 `arm_l`/`arm_r`)+ MCP `log_body_measurement` / `get_circumference_trend`(read ツール同梱=§0.5 ルール)+ 既存 Record か Recovery 画面にフォーム1つ & トレンド。
  - 参照: `packages/core/src/db/migrations/0001_schema.sql:235-243`、`packages/core/src/services/body.ts`。

- ☑ **P2-3 skin_temp の活用(GH 同期側の起動)** `S`(実装不要だった)
  - 調査の結果、skin_temp は**ゲートされておらず既にエンドツーエンドで有効**: `discovery-pin.ts` の `daily-sleep-temperature-derivations` に `unverified` フラグが無く runDailyPull で取込済 → mapper(nightly℃)→ `daily_metrics(skin_temp_c)` → readiness の `SENSING_METRICS`/CONFIG まで配線済み(2026-06-03 正ID訂正時に実装)。
  - 本パスの作業は **docs の旧「恒久除外」記述の訂正のみ**(README.md / CLAUDE.md)。design.md は既に「取込実装済」と正記載。
  - 参照: `packages/core/src/providers/google-health/discovery-pin.ts:105-110`、`readiness.ts:126-137`。

- ☐ **P2-4 血液検査(lab results)コンテナ** `M`
  - GH に schema が無い一級データ。**OCR は作らない**(器=スキーマ + 手入力 + MCP read のみ)。実検査値が溜まってから Claude が経時を語れる状態を先に作る。マイグレーション新設(`lab_results`)。

- ☐ **P2-5 主観コンディション** `M`
  - 睡眠の主観・筋肉痛・気分等。`readiness.ts` の `median()` / `mad()` を再利用。ただし `readiness.muscleLoad` / overall に入れる場合は**明示的に文書化した重み**で、HRV と二重計上させない。

- ☐ **P2-6 AI 永続メモリ(coach_memory)** `M`
  - GH が持てない文脈(オーナーの怪我歴・嗜好・長期方針)。**フラットな `coach_memory` テーブル + 3ツール(put/list/delete)+ 決定的な staleness/expiry 契約を必須**にする。**MCP resource 自動ロードはしない**(毎セッション Claude 自身の古い散文を食わせて過去のハルシネーションに anchor するリスク=決定的文脈 thesis の逆)。

---

## 5. Phase P3 — 整地(任意・余力で)

- ☐ **P3-1 死にスキーマの注記** `S`
  `workout_templates` / `template_exercises` / `template_sets`(0001 の3テーブル)は TS から一切未参照で、後発の `routines`(0017)に役割を奪われた死にスキーマ。マイグレーションは append-only 規律なので物理削除は急がず、`docs/design.md §7` に**「テンプレ系は routines に置換・非推奨」と注記**。
- ☐ **P3-2 死にカラム削除 + 不変条件テスト** `S`
  `workout_sets.weight_kg`(書くが読まない・分析は `toKg()` で再計算)を削除 + `workout_sessions.total_volume_kg === recompute(sets)` の vitest 1本でキャッシュ整合を固定。
- ☐ **P3-3 web↔worker の型契約1つ** `M`
  provenance ラッパ(`api-types.ts` が現状モデル化していない)を型付けし `c.json<T>()` で締め、手書きコピーを削除。**MCP 側に zod outputSchema は入れない**(二重真実源)。
- ☐ **P3-4 `correlate()` 同値分割の修正** `S`
  `nutrition-recovery.ts:72` の tie 分割を決定的化、群 n<min はスキップ、IQR overlap フラグを付して Claude が裸の +3bpm を信号と誤読しないように。全 tie / 半 tie の単体テスト追加。
- ☐ **P3-5 `SIGNAL_STYLE` 重複解消 + 部位マップの型化** `S`
  Home.tsx と Recovery.tsx で同一の `SIGNAL_STYLE` を ui トークンへ集約。`MUSCLE_TO_SLUGS` / `MUSCLE_JA` を `Record<MuscleGroupId, ...>` に型化(タイポを web ローカルのコンパイルエラーに)。

---

## 6. やらないこと(却下)— 規律として明記

単一ユーザーには過剰、または既存の意図的決定の逆行。

- **通知層(outbound push)を作らない** — オーナー決定(D1)。
- **UI 体重入力の堅牢化はしない** — GH 吸い上げ運用(D2)。MCP `log_weight` は残すが投資しない。
- **GH 栄養 push を切らない / cron 投影に作り直さない** — 必須(D3)。weight push が残る限り台帳 FSM・retry・dead_letter・echo guard は全部残るので「~40%削減」は成立しない。
- **2 Worker(web/mcp)を統合しない** — `design.md §3` / `mcp-design.md §7.4` で評価済み却下のセキュリティ決定の逆行。デプロイ忘れ等は `deploy:all` スクリプト + 共有 config で解く。
- **PWA 内に写真→マクロ(server-side vision)を作らない** — リポジトリに vision バインディング不在。既存フロー(撮影→claude.ai 共有→`log_meal_photo` が解析済み items を受ける)で足りる。
- **branded Seconds/Millis 型を全面導入しない** — 境界は既に4 helper + 18往復テストで集約済み。秒対応 date helper 1つ + property test 1〜2本で止める。
- **plateau 検知を OLS/Theil-Sen + CI に作り直さない** — Claude が `get_exercise_history` の生 e1RM から自前再導出する意図的 power-split。やるなら3行頑健化(中央値-of-halves・≥4セッション・±4% デッドバンド)だけ。
- **臨床 Energy Availability / RED-S 線を作らない** — FFM 誤差が信号と同オーダー、男性レジスタンス選手に母集団閾値は無効、实测主义が禁じる「判定の事実偽装」。作るのは相対 under-fuelling フラグ(cut 期の持続赤字 AND readiness 劣化)だけ。
- **栄養スコアに leucine 閾値 / protein 分布を入れない** — leucine バンドは 2026-06-04 に意図削除済(`design.md:162`)。作るのは read-only の `get_protein_distribution` だけ。
- **アプリ内で推奨を生成しない / Home を「今日の意思決定コーチ」に再編しない** — §0.5 が朝ブリーフ/AI 提案を Claude に割当。グランスは事実(残り kcal・stale-region チップ)で強化、判断は出さない。
- **全 MCP ツールに zod outputSchema を入れない** — 二重真実源で自体がドリフトする。契約テストで truth フィールド(`ghPushed`/`idempotentHit` 等)だけを `satisfies` で守る。

---

## 7. 推奨シーケンス

1. **P0-1(landmark_zone)→ P0-2/P0-3(冪等・provenance)** — 嘘を先に止める(単一ユーザー正確性の最大ペイオフ)。
2. **P0-6 → P0-4 → P0-5** — 安価な正直化・耐久化。
3. **P2-1(charter 昇格)→ P2-2(周径)** — モートの第一歩。charter は P0 着手と同日に書いてよい(他項目の優先度を即座に整える)。
4. **P1(GH 同期網羅)** — D4 の網羅性を埋める。
5. **P2-3〜P2-6 / P3** — 余力で。

---

## 8. 出典

- ゼロベース全体レビュー workflow(`ghs-zerobase-review`、2026-06-05): 6サブシステム理解 → 8レンズ提案 → 各提案を単一ユーザー前提で敵対的検証 → 統合。46提案中38採択・8却下。
- 既存 canonical docs: `docs/design.md`(§0/§2/§7/§8.9/§12.6)、`docs/mcp-design.md`、`docs/enhancements.md §0.5`、`CLAUDE.md`。

# レビュー所見統合(検証済み)

最終更新: 2026-06-02

## 概要

各次元(core-correctness / mcp-layer / web-app / consistency-dup-deadcode / tests / docs-drift)の検証済み所見を統合した。すべて実コードで裏取り済み(`isReal && worthFixing`)。本アプリは単一ユーザーの個人用ボディメイク sidecar であり、優先度は「真実(authoring データ)の喪失・二重計上・認証バイパスに直結するか」を最重要軸として判断している。

- 確定: 35 件(P0: 0 / P1: 5 / P2: 30)
- 却下: 15 件(false positive または過剰実装 / over-engineering)

カテゴリ内訳(確定): bug 7 / test 11 / docs 9 / refactor 5 / deadcode 4

最優先で着手すべきは P1 の 5 件。うち 2 件は GH へ送る表示名・LLM 契約のズレ(軽量バグ)、3 件は「真実保全の核」となる経路(retry push 分類 / 削除の GH 連携 / echo ループ防止)が完全に未テストという穴。

---

## P0

該当なし(データ汚染・認証バイパスが現に発生している証拠のある所見は無し)。

---

## P1

### 1. inline GH push のワークアウト displayName が自動命名 title を無視し 'Workout' 固定(retry 経路と不一致)
- カテゴリ: bug
- file: `packages/core/src/services/workout.ts`
- 内容: `workout.ts:92-97` で `title = input.title ?? deriveSessionTitle(...)` をローカル導出し `line 187` で D1 保存。ところが inline push の `line 221` は導出済み `title` ではなく `input.title ?? 'Workout'` を渡すため、自動命名時は常に 'Workout' を GH へ送る。retry 経路(`sync.ts:197` は D1 保存済み `title` を読む)とは「胸・腕」等で食い違う。
- 修正案: `workout.ts:221` を `title: input.title ?? title`(導出済みローカル変数 `title` を使う)に変更。これで D1 保存値・inline push・retry push の displayName が一致する。1行修正。

### 2. get_recent_prs が説明と矛盾(is_provisional を返さない / rep_bucket は常に null)
- カテゴリ: bug
- files: `apps/mcp/src/index.ts`, `packages/core/src/db/repositories/workouts.ts`, `packages/core/src/services/workout.ts`
- 内容: `getRecentPrs`(`workouts.ts:248-254`)の SELECT は `value/rep_bucket/pr_basis/achieved_at` のみで `is_provisional` を返さない。一方 description(`index.ts:303`)は「is_provisional で暫定/確定を区別」と明記。また INSERT は `e1rm` 1箇所のみ(`workout.ts:275-284`)で `rep_bucket` 列が無く、`getRecentPrs` も `record_type='e1rm'` 抽出のため返る `rep_bucket` は構造的に常に NULL。LLM が存在しないフィールドを探す/常時 null のフィールドを意味あるものとして提示する実害。
- 修正案: SELECT に `pr.is_provisional` を追加し、`PrRow`(`workouts.ts:236-244`)と `apps/web/src/ui/lib/api.ts:165-173` の `Pr` 型にも `is_provisional:number` を足す。あわせて description(`index.ts:302-303`)から `rep_bucket` の言及を削る。payload に含めたくないなら最低限 description を `pr_basis`(`pr_basis==='rpe_less'` が暫定)ベースに直す。

### 3. retryPendingPushes の workout/body_metric 経路と catch ハンドラ(RateLimit/permanent)が全て未テスト
- カテゴリ: test
- files: `packages/core/src/services/sync.ts`, `packages/core/src/services/services.integration.test.ts`
- 内容: 既存テストは meal 経路のみ。`sync.ts:187-276` の workout/body_metric/body_metric_fat 再送と catch `:277-287`(RateLimitError→markPushDeferred / ProviderApiError status∈{400,401,403}→permanent dead_letter / それ以外→指数バックオフ)は retryPendingPushes 経由で一度も実行されない。403 即 dead_letter が壊れると無限リトライ/scope 不足 push 暴走に直結。
- 修正案: FakeProvider に `pushExercise`/`pushBodyMetric` の例外注入を追加し、(1)workout pending→synced、(2)body_metric/body_metric_fat の source!=='app'/null skip、(3)RateLimitError→pending 据え置き+next_retry_at 未来、(4)ProviderApiError(403)→dead_letter かつ retry_count=1 を retryPendingPushes 経由で検証。

### 4. deleteWorkout 全体と deleteMeal の GH delete 分岐が未テスト
- カテゴリ: test
- files: `packages/core/src/services/workout.ts`, `packages/core/src/services/nutrition.ts`, `packages/core/src/services/services.integration.test.ts`
- 内容: `deleteWorkout` はテストに一度も出現しない。`deleteMeal` テストは D1 CASCADE のみで `nutrition.ts:230-237` の GH `batchDelete` 分岐(ghDeleted 返却)を通らない。WRITE_DATATYPE は exercise='exercise'/nutrition='nutrition-log'(`discovery-pin.ts:147`)で、取り違えや CASCADE 漏れを現テストは検出不能。FakeProvider.batchDelete/deleteCalls は実装済みなので追加容易。
- 修正案: `saveWorkout(pushInline:true)`→`deleteWorkout` で `ghDeleted===true`・deleteCalls type==='exercise'・workout_sets CASCADE 0・gh_sync_state 0 を検証。`deleteMeal` も featureGhNutritionPush:true + pushInline:true で logMeal 後に削除し ghDeleted と type==='nutrition-log' を検証。

### 5. isKnownOwnWrite の gh_data_origin 一致(echo ループ防止の第2キー)が未テスト
- カテゴリ: test
- files: `packages/core/src/db/repositories/sync.ts`, `packages/core/src/services/services.integration.test.ts`
- 内容: own-write テストは `datapoint_id` 完全一致のみ。`repositories/sync.ts:200-218` は datapoint_id OR gh_data_origin の二段判定で、SQL に `gh_data_origin != ''` の空文字誤一致ガード(`:211`)がある。第2キー経路と空文字ガードは未検証。壊れると自分の push 取込=データ二重計上(P0級汚染)。
- 修正案: `markPushSynced` で datapoint_id を別値・dataOrigin='ghsidecar' の synced 行を作り、reconcile 点を `{id:'different-dp', dataOrigin:'ghsidecar'}` で返して origin 一致 skip を検証。併せて台帳に空文字 origin 行がある状況で dataOrigin='' の外部点が誤 skip されない(取り込まれる)ことも検証。

---

## P2

### bug

#### getMuscleVolume / getWindowSets の窓が windowDays+1 日になり週次ターゲット比が約1日分過大
- files: `packages/core/src/services/workout.ts`, `packages/core/src/db/repositories/workouts.ts`
- 内容: `getMuscleVolume`(`workout.ts:405`)は `jstDaysAgo(7)`=today-7 を since とし、`getWindowSets`(`workouts.ts:166` `s.date >= sinceDate`)が today-7〜today の 8 暦日を集計。`getMuscleCalendar`(`line 474`)は `jstDaysAgo(days-1)` で「当日含めて N 日」規約。actual_sets/vs_target(`line 450-452`)が約1日分過大。
- 修正案: `getMuscleVolume` の since を `jstDaysAgo(windowDays - 1)` にして規約を揃える。

#### get_day のワークアウト取得が getRecentSessions(50) のページサイズに依存し古い日付で取りこぼし得る
- files: `apps/mcp/src/index.ts`, `packages/core/src/db/repositories/workouts.ts`
- 内容: get_day は `(await getRecentSessions(ctx.db, 50)).filter(s=>s.date===d)`(`index.ts:431`)で取得。対象日より新しい完了セッションが 50 件超だと古い日の workout が漏れる。reconcile の pageSize 固定取りこぼしと同クラス。
- 修正案: `repositories/workouts.ts` に `getSessionsByDate(db, date)`(`WHERE s.status='completed' AND s.date=?`)を追加し get_day(`index.ts:431`)で使う。

#### 栄養目標の食塩/食物繊維で 0 を保存できない(|| でデフォルトに化ける)
- file: `apps/web/src/ui/screens/Settings.tsx`
- 内容: `Settings.tsx:170-171` の `saltG: Number(salt) || 6`, `fiberG: Number(fiber) || 20` は `Number('0')===0`(falsy)のため 0 入力がデフォルトへ化ける。kcal/PFC は `|| 0` で 0 が有効値。
- 修正案: 空文字のときだけデフォルト。例: `const num=(s,d)=> s.trim()===''?d:Number(s);` で `saltG:num(salt,6)`, `fiberG:num(fiber,20)`。

#### cron: runDailyPull/staleAbandonedSessions が throw すると push 再送(retryPendingPushes)までスキップ
- file: `apps/web/src/index.ts`
- 内容: `index.ts:42-50` の `await staleAbandonedSessions`/`await runDailyPull` は `.catch` 無し。後続 pull 系は `.catch(()=>undefined)` 付きだが、前段が throw すると保険であるはずの `retryPendingPushes`(`L49`)が走らない。push 再送は真実保全の核。
- 修正案: `staleAbandonedSessions` と `runDailyPull` を個別に `.catch(()=>undefined)` で隔離するか、`retryPendingPushes` を別の try/finally(または独立 ctx.waitUntil)で必ず走らせる。

#### 食事編集はオフライン退避されず、delete 成功後に logMeal がネット不通だと旧データを失う
- files: `apps/web/src/ui/screens/Meal.tsx`, `apps/web/src/ui/lib/api.ts`
- 内容: 編集時は `await api.deleteMeal(editMealId)`→`api.logMeal`、かつ `clientRequestId: editMealId ? undefined`(`Meal.tsx:148-157`)。`submitOrQueue`(`api.ts:27-43`)は crid 無しだと isOffline でも enqueue せず throw。delete だけ成功し再記録が不通だと旧 meal も新 meal も失われる。新規記録は outbox 退避されるのに編集だけ無保護という非対称。§9.8 取りこぼし防止に反する真実喪失。
- 修正案: 編集も delete+recreate を1つの冪等オペレーションとして outbox 対象にする(編集用 crid を発行し submitOrQueue を通す)、または最低限 logMeal 失敗時に delete を取り消す/警告する。

### refactor

#### 塩↔ナトリウム換算ロジックが core と web で二重定義(係数2.54)/ 係数 2.54 が3箇所に散在
- files: `packages/core/src/util/units.ts`, `apps/web/src/ui/lib/units.ts`, `apps/web/src/api/routes.ts`
- 内容: core `util/units.ts:51`(`saltGFromSodiumMg`、`routes.ts:206` で使用)、web `units.ts:16-18`(順変換重複)、web `units.ts:19-21`(`sodiumMgFromSalt` 逆変換)が同一係数 2.54 を別々に保持。core コメント `L49` が分散を追認し SoT が割れている。片方だけ直すと表示(食塩)と保存(GH push の sodium_mg)が食い違う温床。
- 修正案: 換算係数を 1 定数(`SALT_PER_SODIUM=2.54`)に集約し、両方向関数(`saltGFromSodiumMg`/`sodiumMgFromSalt`)を `@ghs/core` 1か所に置く。web は import か re-export して重複を消す。(この所見と「係数3箇所散在」所見は同一問題として統合)

#### web に部位マッピングが二重定義(Training.tsx と lib/muscles.ts)。日本語ラベルが既に乖離
- files: `apps/web/src/ui/screens/Training.tsx`, `apps/web/src/ui/lib/muscles.ts`, `packages/core/src/domain/enums.ts`
- 内容: `TO_SLUG`(`Training.tsx:33-48`)と `MUSCLE_TO_SLUG`(`muscles.ts:27-42`)は16要素すべて一致(完全重複)。画面間で実際に乖離するのは Record.tsx の `MUSCLE_GROUPS.ja`(短縮: 広背/三頭/臀)と Training.tsx の `NAME_JA`(正式: 広背筋/上腕三頭筋/臀筋)で、同一部位が画面ごとに別表記になる本物の不整合。
- 修正案: `Training.tsx` の `TO_SLUG` を削除し `lib/muscles.ts` の `MUSCLE_TO_SLUG` を import。日本語ラベルは NAME_JA か MUSCLE_GROUPS.ja のどちらを単一正とするか決め1ファイルに集約。`MUSCLE_JA` は未使用なので削除。

#### 日付短縮関数 mmdd が formatDateForDisplay と完全重複
- files: `apps/web/src/ui/components/chart.tsx`, `apps/web/src/ui/lib/datetime.ts`, `apps/web/src/ui/screens/Training.tsx`
- 内容: `chart.tsx:16` と `datetime.ts:38` はともに `d.slice(5).replace('-','/')`。Training.tsx は両方を import し混在使用。
- 修正案: `mmdd` を削除し chart の利用箇所も `datetime.ts` の `formatDateForDisplay` に統一(日付整形の単一ソースを datetime.ts へ)。

#### name_ja を web クライアントが運ぶが描画しない(全画面 name_en 表示)
- files: `apps/web/src/ui/screens/Training.tsx`, `apps/web/src/ui/lib/api.ts`, `apps/web/src/api/routes.ts`
- 内容: `name_ja` が型/ペイロード(`api.ts:63/167/272`, `routes.ts:249/266`, `Record.tsx:81`, `Training.tsx:143/618`)を通るが JSX 描画はすべて `name_en`。core/MCP は `name_ja??name_en` を実利用しており web だけ英語名固定=日本語 UI 内不整合。
- 修正案: 方針を統一。日本語 UI なので種目名描画を `name_ja??name_en` にするのが整合的。英語固定で行くなら型/props/レスポンスから `name_ja` を落とす。

### deadcode

#### GET /workouts/:id の if/else 両分岐が同一オブジェクトを push(冗長)
- file: `apps/web/src/api/routes.ts`
- 内容: `routes.ts:272-288` の `if (r.set_index != null && r.entry_value != null)` と `else if (r.set_index != null)` が完全に同一の `{setType,entryValue,entryUnit,reps,rpe}` を push しており分岐に意味がない。
- 修正案: 単一の `if (r.set_index != null) { e.sets.push({...}); }` に統合。

#### GH から取り込んだ active_energy_kcal(消費カロリー)が UI のどこにも表示されない
- files: `apps/web/src/ui/screens/Recovery.tsx`, `apps/web/src/index.ts`, `apps/web/src/ui/screens/Settings.tsx`
- 内容: `pullActiveEnergyDaily` は cron 毎回(`index.ts:48`)実行され daily_metric に保存、/today で返るが、`Recovery.tsx:332-337` の SENSING_META は steps/spo2_avg/resp_rate/vo2max のみで `active_energy_kcal` を除外。集計コストを払って未使用。Settings 連携文言も実取込範囲と乖離。
- 修正案: `SENSING_META` に `active_energy_kcal:{label:'消費',Icon:Flame,unit:'kcal'}` を足して Recovery に表示(摂取kcalとの収支ビューにも繋げられる)。表示予定が無いなら `pullActiveEnergyDaily` を止める。Settings の連携文言も実取込範囲(歩数/消費/HRV等)に合わせる。

#### web lib の未使用 export: MUSCLE_JA / fmtKg / LB_PER_KG
- files: `apps/web/src/ui/lib/muscles.ts`, `apps/web/src/ui/lib/units.ts`
- 内容: 3件とも src 全文検索で参照ゼロ。`MUSCLE_JA`(`muscles.ts:21`)、`fmtKg`(`units.ts:4`)、`LB_PER_KG`(`units.ts:2`、唯一の参照は fmtKg 内のみ)。
- 修正案: 3件を削除。kg/lb 併記が必要になれば core の `formatDual` を使う。

#### MUSCLE_GROUPS.region フィールド(押す/引く 等)が未参照
- file: `apps/web/src/ui/lib/muscles.ts`
- 内容: web ui 内で 'region' は `muscles.ts` 定義行のみヒット。`Record.tsx:375` の MUSCLE_GROUPS.map は ja/id のみ使用。push/pull スキームは core MUSCLE_REGION_JA・Training REGION_GROUPS とも異なる第3グルーピングで未参照。
- 修正案: `MUSCLE_GROUPS` の region フィールドを型ごと削除。push/pull 分類が必要になった時点で core 側に一元定義。

### test

#### active-energy-burned の extractValue 形(activeEnergyBurned.kcal)に単体テストが無い / mappers の body-fat・active-energy dataType 抽出が未テスト
- files: `packages/core/src/providers/google-health/mappers.ts`, `packages/core/src/providers/google-health/mappers.test.ts`
- 内容: mappers.test.ts は weight/steps/daily系/sleep を検証するが、`extractValue` の body-fat(`:162-163`)と active-energy-burned(`:166-167` `field(p.activeEnergyBurned,'kcal')`)が未検証。nutrition の energy は `EnergyQuantity{kcal}` ネスト(`line 80`)で kcal の階層規約が分かれており、フィールド名取り違えで消費カロリー日次集計が黙って 0 になる。active-energy は migration 0014 新規取込で回帰検知が必要。
- 修正案: `mapDataPoint('active-energy-burned', {activeEnergyBurned:{kcal:5, interval:{startTime:'...'}}})`→value=5・timeSec 一致、`mapDataPoint('body-fat', {bodyFat:{percentage:15.5, sampleTime:{physicalTime:'...'}}})`→value=15.5 を追加。probe-active-energy.ts の実応答形を使うのが望ましい。(2 所見を統合)

#### runDailyPull の3日ルックバック since 計算が FakeProvider では観測不能で未検証
- files: `packages/core/src/services/sync.ts`, `packages/core/src/services/services.integration.test.ts`
- 内容: `sync.ts:55` `since = Math.min(st?.last_synced_at ?? firstSince, now - 3*86400)` は「今朝の睡眠が来ない実バグ」修正の核心。FakeProvider.reconcileDataPoints は filter/cursor を無視するため since 巻き戻しを観測不能。退行しても緑のまま。
- 修正案: FakeProvider.reconcileDataPoints に `(ghDataType, filter, cursor)` を記録させ、last_synced_at を now 近くに seed→runDailyPull 後に filter の since が now-3日以前であることをアサート。または since 計算を純粋関数に切り出して単体テスト。

#### e1RM の reps<=12 境界と loadKg<=0 ガードが未テスト
- files: `packages/core/src/domain/metrics.ts`, `packages/core/src/domain/metrics.test.ts`
- 内容: `metrics.ts:55` `reps>12 || loadKg<=0 → null`。既存テストは reps=15 のみで境界 12/13 を踏まず、`>=12` に退行しても検出不能。loadKg<=0 ガード(自重種目で偽 0kg e1RM が PR 台帳混入)も未検証。
- 修正案: `computeE1rmKg(100,12)` 非null・`(100,13)` null、`(0,5)` と `(-10,5)` が null を追加。

#### recencyDecay / estStrengthCaloriesKcal の純粋関数が未テスト
- files: `packages/core/src/domain/metrics.ts`, `packages/core/src/domain/metrics.test.ts`
- 内容: `recencyDecay` は `workout.ts:431`(ヒートマップ stimulus 重み)、`estStrengthCaloriesKcal` は `workout.ts:178`(saveWorkout の est_calories→GH push calories へ伝播)で使用。getMuscleVolume テストは stimulus を assert せず decay 退行を捕捉できない。
- 修正案: `recencyDecay(0,7)===1`、`recencyDecay(3.5,7)≈0.5`、`estStrengthCaloriesKcal(null,3600)===null`・`(70,0)===null`・`(70,3600)` が既知概算値、を追加。

#### logMeal の GH push 失敗時 ghPushed=false / 台帳 failed、saveWorkout push 失敗の整合が未テスト
- files: `packages/core/src/services/nutrition.ts`, `packages/core/src/services/services.integration.test.ts`
- 内容: FakeProvider に `failNutrition` 実装済(`:60`)だが使うテストが無い。logWeight の failBodyFat は検証済だが、logMeal(`nutrition.ts:210-213`)と saveWorkout(`workout.ts:317-320`)の push 失敗経路は未検証。「D1 正本は残り台帳 failed・ghPushed=false」という best-effort 中核保証が抜けている。
- 修正案: `FakeProvider({failNutrition:true})`+featureGhNutritionPush:true+pushInline:true で logMeal→ghPushed===false・meals 行存在・gh_sync_state.sync_status==='failed' を検証。saveWorkout も pushExercise 失敗モードで同様に。

#### apps/mcp に一切のテストが無く、認証境界(timingSafeEqual/ipv4InCidr)が未検証
- files: `apps/mcp/package.json`, `apps/mcp/src/index.ts`
- 内容: apps/mcp に test スクリプト・vitest 依存ともに無く `*.test.ts` が 0 件。`timingSafeEqual`(`index.ts:71-79`)・`ipv4InCidr`(`index.ts:82-102`、bits===0 を特別扱いし JS の `<<0` UB を回避、toInt の符号付き負値を `>>>0` で正規化)は非自明なビット演算。誤れば fail-open=認証バイパス。現状「見た目正しく」動くため予防的価値が中心(P1→P2)。
- 修正案: vitest を追加し純関数 `timingSafeEqual`(一致/不一致/長さ違い)・`ipv4InCidr`(/21 内外, /32, /0, 255.255.255.255, 不正IP, IPv6 スキップ)を単体テスト。auth ミドルウェア(MCP_SHARED_SECRET 未設定 401, ENFORCE_IP_ALLOWLIST=true 範囲外 403)は Hono `app.request()` で軽くカバー。

#### apps/web routes(API 認証ゲート/薄ラッパ)に最小の契約テストが無い
- files: `apps/web/src/api/routes.ts`, `apps/web/package.json`
- 内容: package.json に test script 無し。`requireAuth`(gate.ts)は token 無し/署名鍵無し→401、email 不一致→403、DEV_AUTH_BYPASS は localhost 限定。routes 自動テストは皆無。認証ゲート退行は「本人以外が write 可能」の実害。
- 修正案: vitest + `app.request()` で「未認証(Cookie無し)→401」「不正 email クレーム→403」の最小2本に絞る(全エンドポイント網羅は不要)。

### docs

→ 下記「docs 修正リスト」に集約。

---

## docs 修正リスト

すべて実コードに対する設計書/README のドリフト(実害なし、整合のみ)。SoT を実装に合わせる。

| # | file | 修正内容 |
|---|------|----------|
| D1 | `docs/design.md`(§12.2 `:994-996`) | cron ループ DATATYPES サンプルから `daily-skin-temperature` を外し(§5.4 `:240` 恒久除外と整合)、`active-energy-burned` を「runDailyPull では unverified スキップ、pullActiveEnergyDaily で日次集計 overwrite」として追記。`discovery-pin.ts:104-120`/`sync.ts:45-46,169` 準拠。 |
| D2 | `docs/design.md`(§5.4 `:230-241`, §7 DDL `:593,595`) | マスタ表に active-energy 行を追加、daily_metrics DDL コメントの metric/unit 列挙に `active_energy_kcal`/`kcal` を追記。migration 0014 / `enums.ts:154` 準拠。 |
| D3 | `docs/design.md`(§12.2 `:1000`) | since 算出サンプルを `Math.min(last_synced_at ?? backfill, now-3*86400)` に更新し、後着データ対策(Fitbit→GH ミラー遅延・睡眠 end_time が実行時刻より過去)を本文明記。`sync.ts:52-55` 準拠。 |
| D4 | `docs/design.md`(§5.1 `:250`, §12.2 `:974`) | exercise/sleep pageSize 上限25【確定】記述を、reconcile が pageSize>=1000 を許容する前提に更新。サブリクエスト予算見積りも修正。`provider.ts:37-39` 準拠。 |
| D5 | `docs/design.md`(§5.1 `:185`, §2.1 `:75`, §5.4 `:245`) | `recordingMethod=MANUAL` 記述を `ACTIVELY_MEASURED` へ置換し、own-write 判定は recordingMethod 非依存で `gh_datapoint_id`(isKnownOwnWrite)による旨へ統一(§17.5 で訂正宣言済だが本文未修正)。`sync.ts:66` 準拠。 |
| D6 | `docs/mcp-design.md`(§5.2 表 `:256-274`, §7.6/§9.2/§9.3, `docs/design.md` §13) | ツールカタログを実装済20ツールに更新(`get_training_frequency`/`get_meal_presets`/`delete_meal_preset` を追加)、「M2 で着手(将来)」→「M2 実装完了」へ。`index.ts` registerTool 20件準拠。 |
| D7 | `docs/mcp-design.md`(§5.5-D `:367`, §5.3 schema `:319`) | delete_recent_log の「直近」定義を実装に合わせ ワークアウト=当日 or 最新3件 / 食事=当日・前日 / 体重=当日・前日 に再定義し type enum に 'weight' 追加を明記。`index.ts:707,725,751,768` 準拠。 |
| D8 | `docs/mcp-design.md`(§5.5-F `:371-374`, §9.3 `:556`, §5.2 表 `:263`) | exercise_aliases を「実装済(migration 0012/0013/0015、searchExercises は name_en/ja/alias 横断)」へ更新、search_exercises 返却に `muscles[{muscle,role,contribution}]` を追記。`index.ts:318,350-354` 準拠。 |
| D9 | `docs/mcp-design.md`(§5.2 get_day 行 `:265`, §3 or §5.1) | get_day 返却を「食事 PFC合計+明細・ワークアウト・体重・睡眠サマリ・センシング」へ更新し、MCP server instructions(単位/JST規約・一方向同期・ghPushed/ghDeleted・エネルギー収支=BMR+active_energy_kcal・当日センシング遅延)を1節として明文化。`index.ts:154-160,433-444` 準拠。 |
| D10 | `README.md`(`:12,13,56,98`) | 「GH OAuth Pattern B(未接続)」「MCP(M2)」を実装・接続済へ更新。データフロー表の歩数/消費kcal 行を active-energy 配線済(migration 0014)、皮膚温のみ恒久除外と分離記載。 |
| D11 | `README.md`(`:96`) | 「D1スキーマ(21表)」を「22表(exercise_aliases 含む)」または表数を明記せず「migrations 0001-0015」に修正。0008/0014 は再構築で新規テーブルではない。 |

---

## テスト追加候補(優先度順)

1. **[P1] retryPendingPushes の workout/body_metric 経路 + catch 分類**(`services.integration.test.ts`) — FakeProvider に push 例外注入を追加。RateLimit→pending、403→dead_letter を retry 経由で。最も重要(無限リトライ/scope 暴走防止)。
2. **[P1] deleteWorkout 全体 + deleteMeal の GH delete 分岐**(`services.integration.test.ts`) — ghDeleted・deleteCalls type・CASCADE を検証。
3. **[P1] isKnownOwnWrite の gh_data_origin 第2キー + 空文字ガード**(`services.integration.test.ts`) — echo ループ防止=二重計上防止の核。
4. **[P2] mappers の active-energy-burned / body-fat extractValue**(`mappers.test.ts`) — フィールド名取り違えで消費 kcal が黙って 0 になる回帰を捕捉。低コスト。
5. **[P2] logMeal / saveWorkout の GH push 失敗時整合**(`services.integration.test.ts`) — failNutrition 既存。best-effort 中核保証の穴埋め。
6. **[P2] apps/mcp 認証境界の純関数**(新規 `apps/mcp/src/*.test.ts`) — timingSafeEqual / ipv4InCidr。env 不要、fail-open 防止。
7. **[P2] e1RM 境界 reps12/13 + loadKg<=0**(`metrics.test.ts`) — 偽PR 混入防止。1行レベル。
8. **[P2] runDailyPull の3日ルックバック since**(`services.integration.test.ts` or 純粋関数化) — FakeProvider に filter 記録を追加。
9. **[P2] recencyDecay / estStrengthCaloriesKcal 純粋関数**(`metrics.test.ts`) — GH push calories へ波及。
10. **[P2] apps/web routes 認証ゲート2本**(新規) — 401/403 のみに絞る。

---

## 却下した提案とその理由(再提起防止)

| title | 却下理由 |
|-------|----------|
| upsertGhBodyPoint の ON-conflict UPDATE が date を更新せず measured_at と乖離 | UPDATE が date 非更新は事実だが、体重/体脂肪の physicalTime は記録時固定で後続 sync の JST 日境界またぎは実質起きない。理論的指摘で実害ほぼ無し。 |
| sleep 取込の startAt フォールバックが nowSec() で未来時刻を捏造 | 破損機構が成立しない。extractTimeSec が 0 を返し `0 ?? nowSec()` は 0(nullish でない)で nowSec() に到達しない。中核主張が誤り。isReal=false。 |
| retryPendingPushes の meal 集計が own helper を持たず重複 | 重複は事実だが retry は初回失敗時のみの稀ケースで、差は foodDisplayName の品数表記揺れのみ。栄養値合算は同一。やるなら name 1行統一で足り、優先度低。 |
| delete_recent_log のエラー応答が fail() でなく ok({error}) で不統一 | 不整合は事実だが LLM は text 内 JSON の error を読めるため機能上の実害なし。純粋な一貫性リファクタ。 |
| log_meal/log_workout/log_meal_photo で SDK 検証済み引数を再度 .parse() | SDK が handler 前に検証済みで二重検証は冗長だが、.min/.max は保持され無害。実害ゼロ。 |
| today クエリのキー不整合(['today'] と ['today',date])で二重取得 | キー別エントリで余分フェッチは事実だが invalidate は prefix(exact:false)で両方更新でき整合性バグ無し。軽い余分フェッチのみ。 |
| 食事編集再保存で kcal/PFC が整数に丸められ精度低下 | 整数化は事実だが手入力 1g 単位で実用十分。本アプリは推測値の精度幻想を避ける方針。実害小、丸め変更は他箇所整合も要確認。 |
| core util/units の formatDual/convert/toLb が本番未使用 | 未配線は事実だが「kg/lb 併記(要件8)」の将来表示用 API。捏造でなく未配線で、削除すると後で再実装。core 公開数行、実害ゼロ。 |
| FitbitProvider が全メソッド throw のスタブで未配線 | throw スタブは事実だが既に barrel 非公開で隔離済み。HealthProvider 抽象は GH/fake 注入に実用。33行・実害ゼロで削除価値低。 |
| apps/mcp(20ツール薄ラッパ)はテスト無し | logMeal/saveWorkout は Schema.shape 再利用 + spread 透過で手動マッピングがほぼ無く、全 write は core テスト済 services 経由。二重テストは過剰(認証境界の純関数テストは別途 P2 で採用)。 |
| MCP の IPv6 送信元は二次 IP allowlist を素通り | `ip.includes(':')` で allowed=true 固定は事実(isReal)だが一次防御 MCP_SHARED_SECRET は fail-closed・定数時間比較で常時有効。design §6.3 が v6 二次防御を fail-open 前提と確定済み。v6 厳格化は非目標。 |
| MCP 共有 secret が URL クエリ(?key=)に乗りログに残る | URL クエリ経路・observability 有効は事実だが Claude.ai Custom Connector の URL 埋め込み制約は確定事項。mcp-design §541 で既知リスクとして受容済み。secret はローテート可能。コード変更を伴わない運用トレードオフ。 |
| セッション JWT 検証で署名アルゴリズムを明示固定していない | algorithms 未指定は事実だが検証鍵が対称生バイト列のため非対称 alg-confusion は成立せず、none も jose が拒否。verifyGoogleIdToken は別系統で issuer/audience 固定。実害なし、純粋な defense-in-depth。 |

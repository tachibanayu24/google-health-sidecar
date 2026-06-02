# Logbook MCP — レビューパケット(self-contained)

> このファイル単体を Claude.ai（このMCPの**利用者**となる AI）に貼って、設計レビューを依頼するためのものです。
> リポジトリにアクセスできない相手でも判断できるよう、必要な前提・契約・スキーマをすべて inline 済み。
> 正典の全文は `docs/mcp-design.md`(本パケットはその利用者向け抜粋+文脈)。

---

## ■ レビュー依頼(この節をそのまま指示として読んでください)

あなたはこれから接続される remote MCP サーバ **「Logbook MCP」の利用者**です。
= あなた自身が MCP クライアントとして、これらのツールを呼んで「食事・ワークアウト・体重」を記録・分析します。
対象は **単一ユーザー(オーナー本人)専用**のボディメイク用 Google Health sidecar アプリの MCP 部分。実装はまだ。**設計レビュー**をしてほしい。

### 最重要の視点(利用者エルゴノミクス)

実際にツールを呼ぶ立場として、特に次を見てください:

1. **曖昧さ**: ツール名・説明・入力スキーマだけで、各ツールを誤りなく呼べるか。取り違え・誤用しそうな箇所は?
2. **過不足**: authoring（記録）に必要なツールが揃っているか。read / write / destructive の分割は妥当か。
3. **典型フローの詰まり**: 例「写真や会話から栄養を見積もって食事を記録」「会話からワークアウトを記録」で、不足する情報・余計な往復・失敗しやすい点は?
4. **明快さ**: 単位（kg 固定 / `entry_unit`)、meal type 列挙、必須/任意、冪等キー `clientRequestId` の運用が利用者目線で明快か。
5. **安全性**: 破壊的操作(削除)の確認フローは安全かつ実用的か。GH push 成否の伝え方は十分か。

### 変更不可の前提(是非は再議論しない。**この制約下での**ツール設計の良否だけ見る)

- 単一ユーザー個人アプリ（過剰実装は減点）。
- 認証 = `MCP_SHARED_SECRET`(一次・fail-closed)+ Anthropic outbound IP allowlist(二次)。**OAuth なし・claude.ai Custom Connector**。← 既にセキュリティレビュー済みの確定事項。
- トランスポート = ステートレス `@hono/mcp` + Streamable HTTP（**Durable Object 不採用**）。
- 食事は **app/MCP → D1(正本) → GH push の一方向**。GH から栄養は読み戻さない（echo 回避）。
- すべての write は既存 `@ghs/core/services` を薄くラップ（生 SQL を書かない）。

### 出力フォーマット

① 致命的な問題 ② ツールごとの具体的改善（名前/説明/スキーマ） ③ 不足ツール ④ 利用者として困る点 ⑤ 良い点。
抽象論でなく、ツール名・パラメータ名・具体的な呼び出し例を挙げて指摘してください。

---

## ■ システム文脈(設計の前提)

**Logbook** = オーナー専用の Google Health(GH)sidecar PWA。Cloudflare Workers + D1(SQLite) + KV。

**2層 source of truth**:
- **D1 = authoring 正本**: 食事 / ワークアウト / 手入力体重。アプリと MCP が書く。
- **GH = sensing 正本**: 睡眠 / 心拍 / HRV / SpO2 等。pull して表示のみ。

**食事の一方向フロー**: `Claude(MCP) → D1(正本) → GH push`。GH から栄養は pull しない（構造的に echo を作らない）。
冪等は `client_request_id`。GH push は best-effort（失敗は web 側 cron が再送）。

**MCP の役割**: Claude を authoring クライアントにする薄い接合点。MCP は分析(read)と記録(write)を提供し、すべての write は下記の core サービスを呼ぶだけ。

### ラップ対象 core サービス（検証済みシグネチャと返り値）

| サービス | シグネチャ | 返り値 |
|---|---|---|
| 食事記録 | `logMeal(ctx, LogMealInput)` | `{ mealId, ghPushed }`（同 clientRequestId は再記録せず既存 id を返す） |
| プリセット保存 | `saveMealPreset(ctx, {name, defaultMealType, items})` | `{ presetId }` |
| ワークアウト記録 | `saveWorkout(ctx, SaveWorkoutInput)` | `{ sessionId, totalVolumeKg, newPrs }`（e1RM/PR は core 計算。**title 省略時は内容＝主働筋の部位から自動命名**） |
| 体重記録 | `logWeight(ctx, LogWeightInput)` | `{ id, ghPushed }`（**clientRequestId 無し** → soft-guard で対処） |
| 栄養目標設定 | `setNutritionTarget(ctx, input)` | `{ ok:true }` |
| 食事削除 | `deleteMeal(ctx, mealId)` | `{ deleted, ghDeleted }` |
| ワークアウト削除 | `deleteWorkout(ctx, sessionId)` | `{ deleted, ghDeleted }` |
| 種目履歴 | `getExerciseHistory(ctx, exerciseId, {since?, limit?})` | 生値+計算済み（load_kg / set_volume_kg / e1rm_kg）のセット時系列 |
| 部位ボリューム | `getMuscleVolume(ctx, {windowDays?})` | `[{muscle, actual_sets, volume_kg, target_sets, stimulus, vs_target}]` |
| 部位カレンダー | `getMuscleCalendar(ctx, {days?})` | `{days, sessionDates, cells:[{date, muscle, sets}]}` |
| 種目検索 | `searchExercises(ctx.db, {query?, muscle?, equipment?, favorite?, limit?})` | 候補 `[Exercise]`（部分一致） |
| 食品オートコンプリート | `autocompleteFoods(ctx.db, q, limit)` | 過去記録 `[MealItem]` |
| 日次・最近・PR・設定 | `getMealsByDate` / `getRecentSessions` / `getRecentPrs` / `getSettings` / `getActiveNutritionTarget`（`ctx.db`） | 各行 |

---

## ■ ツールカタログ（17本：read 9 / write 7 / destructive 1）

設計原則:
- **全 read に `provenance`**: 前日(JST)以前=`d1_confirmed`、当日未ミラー sensing=`gh_provisional`(+`as_of`)。栄養は常に D1 正本のみ。
- **正規化値は kg/ml 固定**。フィールドに `_kg`/`_kcal`/`_ml` を付け、`entry_unit`(`kg|lb`)を明示（単位誤変換の最重要対策）。
- **生値 + 計算済み値の両方**を返す（e1RM 式の再実装不要）。
- **種目名解決は部分一致**。複数/0件は曖昧エラーで候補配列を返す → 確実な解決は `search_exercises` で id を得てから。
- **GH push 成否を正直に**: write は `ghPushed`、delete は `ghDeleted` を必ず含める。

| # | ツール | 種別 | 目的 | 呼ぶ core | 返却 | 冪等 |
|---|---|---|---|---|---|---|
| R1 | `get_exercise_history` ★中核 | read | 種目の全セット時系列(生値+計算済み)。分析の生命線 | `getExerciseHistory` | `{provenance, sets:[{set_index,set_type,entry_value,entry_unit,load_mode,load_basis,reps,rpe,load_kg,set_volume_kg,e1rm_kg,session_date}]}` | N/A |
| R2 | `get_muscle_volume` | read | 部位別 週間ボリューム+目標比較 | `getMuscleVolume({windowDays?})` | `[{muscle,actual_sets,volume_kg,target_sets,stimulus,vs_target}]` | N/A |
| R3 | `get_muscle_calendar` | read | 直近 N 日 部位×日 ヒートマップ。頻度・分割の俯瞰 | `getMuscleCalendar({days?})` | `{days,sessionDates,cells:[{date,muscle,sets}]}` | N/A |
| R4 | `get_recent_sessions` | read | 直近セッション一覧。delete 対象 id 特定にも | `getRecentSessions` | `[RecentSessionRow]`+`provenance` | N/A |
| R5 | `get_recent_prs` | read | PR 台帳(暫定/確定を `is_provisional` で区別) | `getRecentPrs` | `[{record_type,value,unit,rep_bucket,achieved_at,is_provisional,pr_basis}]` | N/A |
| R6 | `search_exercises` ★解決 | read | 種目候補の部分一致検索 = id 解決の起点 | `searchExercises` | `[{id,name_en,name_ja,equipment,laterality,load_basis,is_bodyweight,bw_factor,muscles}]` | N/A |
| R7 | `autocomplete_foods` | read | 過去記録食品の PFC 再利用候補 | `autocompleteFoods` | `[MealItem]` | N/A |
| R8 | `get_day` | read | 指定日の俯瞰(食事PFC合計+明細・ワークアウト・体重) | 集約 | `{date,nutrition,workout,body,provenance}`(当日sensingは`gh_provisional`+`as_of`) | N/A |
| R9 | `get_settings` | read | 単位/e1RM式/栄養目標/週間目標セット数 | `getSettings`+`getActiveNutritionTarget` | `{unit_preference,e1rm_formula,nutrition_target,weekly_target_sets}` | N/A |
| W1 | `log_meal_photo` ★ | write | 写真→Claude視覚解析→items[]→記録+GH push。MCP 最大の価値 | `logMeal` | `{mealId,ghPushed,idempotentHit}` | clientRequestId(MCP生成) |
| W2 | `log_meal` | write | テキスト/構造化食事を記録+GH push | `logMeal` | `{mealId,ghPushed,idempotentHit}` | clientRequestId(MCP生成) |
| W3 | `log_preset` | write | D1 preset から食事記録 | `logMeal({presetId,...})` | `{mealId,ghPushed,idempotentHit}` | clientRequestId(MCP生成) |
| W4 | `save_meal_preset` | write | よく食べる構成を D1 preset 保存 | `saveMealPreset` | `{presetId}` | 名前重複は core 挙動 |
| W5 | `log_workout` | write | 自然言語/構造化ワークアウト記録(e1RM/PRはcore) | `saveWorkout` | `{sessionId,totalVolumeKg,newPrs,idempotentHit}` | clientRequestId(MCP生成) |
| W6 | `log_weight` | write | 体重/体脂肪の手入力+GH push | `logWeight` | `{id,ghPushed}` | **無し**→soft-guard |
| W7 | `set_nutrition_target` | write | 栄養目標(phase/PFC/kcal)設定 | `setNutritionTarget` | `{ok:true}` | 上書き |
| D1 | `delete_recent_log` | destructive | **直近の**食事 or ワークアウトの取消のみ(D1削除+GH datapoint best-effort delete) | `deleteMeal`/`deleteWorkout` | `{deleted,ghDeleted}` | `idempotentHint`(同id再削除no-op) |

**意図的に出さないツール**: `append_to_workout`(core に in_progress 合流が無い→将来)、`get_sensing`/`get_nutrition_log`/`get_training_frequency`(当面 `get_day`/`get_recent_sessions`/`get_muscle_calendar` で代替)。

**破壊的操作は `delete_recent_log`(直近取消)のみ**: 任意IDの無確認削除・一括削除・上書き編集は出さない(誤削除リスク)。確認は §安全 の echo+confirm 二段。

---

## ■ 入力スキーマ（実 Zod / `@ghs/core/domain/inputs.ts` をそのまま inputSchema に転用）

```ts
// 1食品の栄養(食事記録・プリセット共通)
MealItemInputSchema = {
  foodName: string(1..120),           // 必須
  caloriesKcal: number(0..20000),     // 必須
  proteinG?, fatG?, carbsG?: number(0..2000),
  fiberG?: number(0..500), sugarG?: number(0..2000), sodiumMg?: number(0..100000),
  quantity?: number>0, unit?: string(<=20),
}

// 食事記録(log_meal / log_meal_photo / log_preset)
LogMealInputSchema = {
  mealType: MealType,                 // 必須 enum（下記）
  items: MealItemInputSchema[1..50],  // 必須
  date?: 'YYYY-MM-DD', loggedAtSec?: epochSec, note?: string(<=500),
  inputMethod?: 'manual'|'photo'|'preset',  // log_meal_photo はサーバが 'photo' 固定注入
  presetId?: string,
  clientRequestId?: string(1..64),    // 同一記録の再送防止に再利用。省略時サーバ生成し結果に返す
}
// ※ log_meal_photo は「Claude 側で解析済みの items[] を渡す」前提。画像バイナリは受けない（未決#1）。

// ワークアウト記録(log_workout)
SaveWorkoutInputSchema = {
  exercises: [{                       // 必須 [1..40]
    exerciseId: string,               // 必須・search_exercises で解決した id
    note?: string(<=500),
    sets: [{                          // [0..50]
      setType?: 'warmup'|'main'|'drop'|'backoff'|'amrap'|'failure',  // 既定 main
      loadMode?: 'weighted'|'bodyweight'|'assisted',
      entryValue?: number(0..2000)|null, entryUnit?: 'kg'|'lb',
      reps?: int(0..1000)|null, rpe?: number(0..10)|null,
      restSec?: int|null, performedAtSec?: epochSec|null,
    }],
  }],
  date?: 'YYYY-MM-DD', title?: string(<=120),   // title 省略時は内容から自動命名
  startedAtSec?, endedAtSec?: epochSec,
  bodyweightKg?: number>0(<=500)|null,           // 自重種目の挙上重量・消費kcal算出に使用
  status?: 'in_progress'|'completed',
  clientRequestId?: string(1..64),
}

// 体重記録(log_weight) ※ service interface 由来。MCP 用に同型 zod を定義
LogWeightInput = {
  entryValue: number,                 // 必須
  entryUnit: 'kg'|'lb',               // 必須・名前と説明に単位明示
  bodyFatPct?: number(%),
  date?: 'YYYY-MM-DD', measuredAtSec?: epochSec,
}

// 栄養目標(set_nutrition_target)
SetNutritionTargetInput = { phase: 'bulk'|'cut'|'maintain', kcal, proteinG, fatG, carbsG, saltG?, fiberG?, dateFrom? }

// 削除(delete_recent_log)
{ type: 'meal'|'workout', id: string, confirm?: boolean }   // echo+confirm 二段

// read 系
get_exercise_history { exercise: id|名前, since?: 'YYYY-MM-DD', limit?<=2000 }
get_muscle_volume    { windowDays?(既定7) }
get_muscle_calendar  { days?(既定30) }
get_recent_sessions  { limit?(既定30) }
get_recent_prs       { limit?(既定20) }
search_exercises     { query?, muscle?, equipment?, favorite?, limit?<=50 }
autocomplete_foods   { q, limit?(既定8) }
get_day              { date?('YYYY-MM-DD', 既定 今日JST) }
get_settings         { }（引数なし）
```

### 列挙値（利用者が知っておくべき固定値）

- **MealType**: `Breakfast` `MorningSnack` `Lunch` `AfternoonSnack` `Dinner` `Anytime`（GH へは BREAKFAST/LUNCH/DINNER/SNACK に写像）
- **SetType**: `warmup` `main` `drop` `backoff` `amrap` `failure`（総量・PR は `main` 系のみ計上、`warmup` は除外）
- **LoadMode**: `weighted` `bodyweight` `assisted`
- **WeightUnit**: `kg` `lb`（正規化は kg）
- **部位 muscle id**（search_exercises の `muscle` / 返却の muscles）: `chest, lats, traps, front_delts, side_delts, rear_delts, biceps, triceps, forearms, abs, obliques, quads, hamstrings, glutes, calves, lower_back`

---

## ■ 冪等・安全・一方向（利用者として守る/期待できること）

- **冪等(write)**: 同一の論理記録には**同じ `clientRequestId` を再利用**せよ（再送が二重登録にならない）。省略時はサーバが UUID を生成し結果に含めて返すので、明示リトライ時はその値を使う。core が `client_request_id` で dedup 済み。
- **体重(`log_weight`)は clientRequestId 無し** → サーバは記録前に同日の近い体重を検出して警告を返す soft-guard。重複なら呼ばない、別測定なら confirm。
- **削除は二段**: `delete_recent_log` は confirm 省略時、対象が「直近」かを検証し、範囲外なら actionable エラー、範囲内なら**削除せず対象内容を echo**（「mealId=… の 鶏胸肉 250kcal×3 を削除します。`confirm:true` で実行」）。`confirm:true` で実行し `{deleted, ghDeleted}` を返す。
- **一方向**: MCP は GH から栄養を pull するツールを一切公開しない。`get_day` の当日 sensing は睡眠/HR 等のみ速報、栄養は D1 正本のみ。
- **GH push 成否**: write は `ghPushed`、delete は `ghDeleted` を必ず含む。`false` のとき「GH に入った」と誤報告しないこと。`FEATURE_GH_NUTRITION_PUSH` OFF なら `ghPushed:false`。

---

## ■ 既知の未決事項（レビューで意見が欲しい点）

1. **`log_meal_photo` の責務分界**: 画像バイナリは受けず「Claude が解析した items[] を渡す」前提（= `log_meal` とほぼ同型で `inputMethod='photo'` 固定）。これは利用者として自然か? 画像を MCP に渡せた方が良い場面はあるか?
2. **`log_weight` の冪等**: core に clientRequestId が無いため soft-guard で代替。利用者として十分か、core 改修で冪等化すべきか。
3. **read ツールの粒度**: `get_day` + `get_recent_sessions` + `get_muscle_calendar` で sensing/頻度を代替し、専用 read を絞った。authoring/分析で実際に詰まらないか。

---

*(正典全文・アーキ図・デプロイ手順・ロールアウト段階は `docs/mcp-design.md` を参照。本パケットは利用者レビュー用の自己完結抜粋。)*

# 機能拡張アイデア帳(横断リサーチ由来)

2026-06-02 作成。Hevy / Strong / RP / MacroFactor / Cronometer / Whoop / Oura / Garmin / Apple / Spotify Wrapped / Strava / Duolingo / Fitbit(Gemini)Coach / WHOOP Coach / JuggernautAI 等を横断調査し、**このアプリにしか作れないもの**に絞った拡張候補。未着手のストック(運用しながら順次)。

## 0. 横断方針(全案で守る)

- **最大の武器 = MCPのAIトレーナー × 二層構造(食事=D1正本 / 回復センシング=GH)× 実測主義。** Whoop/Oura は回復だけ、MacroFactor は栄養だけ。両方持ち、AI が読んで喋れるのはうちだけ。
- **実測主義ルール(各社のベストプラクティスと一致)**:
  - 偽スコア(0-100の合成値)は出さない → **信号(緑/黄/赤)+ 実測値 + あなたの平常範囲** で見せる。
  - 判定は**個人ベースライン比**(直近14日 vs 8週 等の相対逸脱)。学習期間中は「あとN日」と正直に出す。
  - データ不足/遵守不足なら**出さない・調整しない**(誤った最適化で信頼を壊さない)。
  - 推定値は必ず「推定」ラベル + 根拠。因果・p値は主張しない(相関は n と中央値差だけ)。
- effort 凡例: **低** = UI/集計のみ・新規データ不要 / **中** = 集計 + 軽いスキーマ or MCPツール追加 / **大** = 新規ロジック(回帰・週次自動調整)込み。

## 0.5 絞り込みレンズ(MCP前提 — 最重要)

**前提**: AIコーチングの価値は Claude 側に MCP 経由で宿る。しかも**横断セッションの文脈**(トレ以外の会話でもこのアプリのデータを参照させられる)が本質。だから **「アプリ自体を AI コーチにする」必要はない・今やることでもない。**

判定を3バケツで:

- **(A) アプリしか持てない** = 忠実な記録 / 決定的な計算・正規化 / 可視化・シェア画像 / **能動プッシュ通知**(Claudeは非会話時に届けられない)/ オフラインのジム体験。→ **作る**
- **(B) moat の増幅** = 計算した派生指標・信号を **新しい MCP read ツールで露出**。Claude が横断セッションで参照する文脈が厚くなる。→ **最高レバレッジ・最優先**
- **(C) アプリ内AI**(朝ブリーフ生成 / アプリ内チャット / 講評文 / AI提案 / 相関エンジン)= Claude-via-MCP と重複。**作らない**。生データを MCP で出せば Claude がやる。

**変換則**: 「アプリが◯◯をテキスト生成して見せる」案は全部 **「その計算結果を MCP read ツールで返す」に置き換える**。
- ❌ アプリが「今日は休め」を LLM 生成して保存・表示
- ✅ アプリは Readiness を**決定的に計算**して `get_readiness` で返す → Claude が会話で(トレ以外の文脈でも)助言

### この前提での再優先度

| バケツ | 採用 | 落とす(Claudeに任せる) |
|---|---|---|
| 即やる(A・アプリnative) | ①ライブPR演出+共有 / ⑫前回超えプレフィル / ⑧MEV-MAV可視化 /(⑯⑮⑪も安い) | — |
| 次(B・MCP露出) | ✅ **`get_readiness`**(2026-06-03 実装, design.md §8.8) / ✅ **`get_weekly_summary`**(実装済) / **`get_nutrition_status`**(適応型TDEE) / volume landmarks の MCP 露出。土台=✅④ベースライン計算 + ⑩TDEE計算 | — |
| プッシュのみアプリ | ⑦ N-of-M 逸脱アラート(限定的) | — |
| 作らない | — | ②朝ブリーフ / ③講評文・チップ / ⑥相関エンジン / ⑬AI提案 / ⑭停滞検知 |

> 当面のテーマ = **「アプリ = 最高の文脈プロバイダ」**。決定的な派生指標を計算して **MCP の read 面を厚くする**ことに投資する。下の Tier 表記は据え置くが、着手順はこの §0.5 を優先する。各案の「MCPで露出すべき計算結果」は設計の `get_*` 言及を参照。

---

## Tier 1 — まず作る(安い × 効く × 映える)

### 1. ライブPR演出 + 1タップ共有 〔低〕
- 概要: セット保存の瞬間に新PRを検知 → 祝福オーバーレイ → そのまま共有画像へ。
- 設計:
  - トリガ: `saveWorkout` の派生再計算(§8.5)で `personal_records` に新規/更新が出たら検知。
  - 出し分け: `record_type`(e1rm / weight_at_reps / max_reps_at_weight / max_volume_session)で文言。
  - 確度: `is_provisional=0`(確定)=金フル演出 / RPEレス由来(暫定)=銀+「RPEを入れると確定」。
  - 演出: ローカルのみ(トースト+ハプティクス。iOS Web Push は使わない)。
  - 導線: 演出から既存 `ShareImageModal`(ワークアウト)へ1タップ。
  - データ: `personal_records`, `workout_sets`(既存)。新規取得なし。
- 参照: Hevy(Live PR), Apple(達成の即時表彰)。

### 2. 朝の能動ブリーフ「今日のひとこと」 〔中〕
- 概要: 毎朝 Claude が前夜の回復+前日の疲労を読み「攻め/つなぎ/休養 + 理由 + 今日の一手」をホーム最上部に。
- 設計:
  - Cron(web worker `scheduled`, 既存 `*/5` に時刻ゲートで朝1回)で生成。
  - 入力: `sleep_logs`(deep/rem/efficiency), `daily_metrics`(hrv_rmssd/resting_hr), 前日の部位別ボリューム(§8.3刺激)。
  - 生成: Claude(MCP/サーバ側呼び出し)が短文化。数値は集計値を埋め込み、文章だけ生成。
  - 保存: D1 に `daily_brief(date, signal, body, created_at)` を1行 upsert。
  - 表示: PWA ホーム最上部に小カード。当日分が無ければ非表示。
  - 注意: 信号+根拠実測値のみ。判定は Tier2-④ のベースライン関数を再利用。
- 参照: WHOOP Coach(Daily Outlook), Fitbit Gemini Coach。

### 3. チャット定型チップ + 週次コーチ講評 〔低〕
- 概要: AIトレーナーの価値を PWA から1タップで。週間Wrapped に講評文を一段重ねる。
- 設計:
  - 定型チップ(静的UI): 「今日何を鍛える?」「停滞してる種目は?」「今週のPFCの穴は?」等 → タップで MCP 越しに回答。
  - 週次講評: 既存 `/weekly-summary` の集計を Claude に渡し短い講評を生成 → Wrapped 画像/週次ビューに重ねる。
  - データ: 既存全データを MCP read 経由。サーバ追加ほぼ不要。
- 参照: WHOOP(suggested prompts / 週次アセスメント), Strava(Year in Sport の物語化)。

---

## Tier 2 — 二層構造を活かす(他社に作れない固有資産)

### 4. 個人ベースライン基盤(14日 vs 8週)共通関数 〔中〕— ※他案の土台 ✅実装済(2026-06-03, design.md §8.8)
> 実装は「直近最大60日の中央値±MAD による robust z」。当初案の「14日 vs 8週」より単純な単一ローリング窓 + 学習ゲート(14日)に確定。
- 概要: 各 daily metric の「あなたの平常範囲」を出す純関数。Readiness/通知/MCP回答が全部これを参照。
- 設計:
  - core services に純関数: 直近14日の中央値±MAD を 直近8週中央値と比較し `low|normal|high|learning` を返す。
  - 14日未満は `learning`(あとN日)で判定を出さない。
  - 対象: hrv_rmssd / resting_hr / resp_rate / spo2_avg / 睡眠 efficiency・deep_min。
  - read 専用派生(§8.5 write 経路に無関係)。
- 参照: Oura(HRV Balance), Garmin(HRV Status 7日), Apple(typical range)。

### 5. Readiness信号(緑/黄/赤)+ `get_readiness` MCPツール 〔中〕 ✅実装済(2026-06-03, design.md §8.8)
> 実装差分: 総合は N-of-M(2指標同時逸脱で赤)。中核 HRV は ln→7日ローリング平均。呼吸数のみ絶対閾値。皮膚温は文脈指標として組込。ACWR 同梱は将来(⑨)。
- 概要: 朝イチの一枚。偽スコアは出さず「内訳バー + 実測値 + 平常範囲」。
- 設計:
  - 各指標を ④ の関数で判定 → contributor バーを縦に(例「HRV 48ms / 平常 52-68ms ↓」)。
  - 総合は**信号のみ**(0-100は出さない)。欠損指標は「—(データ無し)」で合成しない。
  - 当日分は §8.7 の gh_provisional(速報+as_of)を流用。
  - MCP: `get_readiness(date?)` を追加(信号+contributor実測+部位別ACWRサマリ)。「今日攻めていい?」に即答。
  - データ: `daily_metrics`, `sleep_logs`(既存)。
- 参照: Whoop(Recovery), Oura(Readiness contributors), Garmin(Training Readiness)。

### 6. 食事×回復の相関 / LEAアラート 〔中〜大〕— ★本命の固有資産
- 概要: 食事(D1)と翌朝の回復(GH)を自動クロス。Whoop Journal を手入力なしで。
- 設計:
  - 相関: 説明変数=食事(PFC/塩/糖/`meals.logged_at`)・前日ボリューム、目的変数=翌朝 hrv_rmssd/resting_hr/睡眠効率。層別比較(例「21時以降に最後の食事の翌朝 vs それ以外」)。
  - 出力: **n と中央値差だけ**(「塩分高い翌朝はRHR+3, n=18」)。因果・p値は出さない。N不足は「今週は発見なし」。
  - LEA: 減量フェーズ中、摂取が推定TDEE(Tier3-⑦)を大きく下回り続け、かつ回復指標が同時にベースライン悪化 → 注意喚起。閾値は全て自分比(相対)。
  - 置き場所: Cron 週次/日次バッチ + 週次講評(Tier1-③)/MCPで提示。
  - データ: `meal_items`, `meals`, `daily_metrics`, `sleep_logs`(既存)。
- 参照: Whoop(Journal correlations), LEA/RED-S(スポーツ栄養)。

### 7. 複数指標逸脱アラート(N-of-M) 〔低〕
- 概要: HRV↓/RHR↑/呼吸↑/SpO2↓/睡眠効率↓ のうち**2つ以上**崩れた朝だけ通知。
- 設計:
  - 既存 Cron + ④ のベースライン判定で「平常外」を数える。`>=2` で発火。
  - 通知: 既存の Slack/Email/Discord 経路(§12.5)or PushNotification を再利用。1通だけ。
  - 1指標のブレでは鳴らさない(誤報抑制)。
- 参照: Apple Watch(Vitals の N-of-M)。

### 8. 部位別ボリュームを MEV/MAV ランドマーク帯で 〔中〕 ✅実装済(2026-06-03, design.md §8.9)
> migration 0016 で MEV/MAV/MRV をシード(RP/Israetel・ガイドライン明示)。`get_muscle_volume` に `landmark_zone` 露出、Training に帯バー。obliques/lower_back は帯なし。
- 概要: 「全部位グリーンゾーン」が映える + 弱点埋めが楽しい。
- 設計:
  - `muscle_groups.weekly_target_sets`(単一値)を MV/MEV/MAV/MRV のレンジ列へ拡張(migration + シード。RP値は出典明記)。
  - 週間実績セット数(`workout_sets`→`exercise_muscles` contribution 経由)が帯のどこか → MEV未満=青/MAV帯=緑/MRV超=赤。
  - 既存ヒートマップに「ランドマーク基準」モード追加。`get_muscle_volume` 返り値に `landmark_zone` 追加(AIも参照)。
  - データ: 既存 + `weekly_target_sets` 拡張シード。
- 参照: Renaissance Periodization(Dr. Mike Israetel)。

### 9. 部位別 ACWR(急性:慢性 負荷比) 〔中〕 ✅実装済(2026-06-03, design.md §8.9)— ただし看板変更
> ACWR の**怪我予測は学術的に否定済**(Impellizzeri 2020 等)。実装は怪我リスクを主張せず「直近7日 vs 28日週平均の記述指標(detraining/steady/ramping/spiking)」に限定。`get_readiness` に muscleLoad 同梱。0.8–1.3 の魔法ゾーンは出さない。
- 概要: 「今日この部位は攻める/守る」。直近7日合計 ÷ 直近28日週平均。
- 設計:
  - 16筋群×日次ボリュームから筋群ごとに ACWR 算出。>1.5=橙(攻めすぎ)/0.8-1.3=緑/<0.8=伸びしろ。
  - Readiness 画面・記録画面にヒートマップ。`get_readiness` にも同梱。
  - read 専用集計のみ(全部実測ログ由来=捏造ゼロ)。
- 参照: Garmin/Firstbeat(ACWR), Apple(Training Load), Whoop(Muscular Load)。

---

## Tier 3 — もう一段(効果大・やや重い)

### 10. 適応型TDEE + 週次オートコーチ(遵守ゲート) 〔大〕
- 概要: 体重トレンド×摂取から消費を逆算し、目標を毎週自動提案。MacroFactor の自前版。
- 設計:
  - トレンド体重 = 体重(`body_metrics`)の加重移動平均。
  - TDEE ≈ 平均摂取 −(トレンド体重変化 × 7700kcal/kg)。過去14-28日窓。
  - 週1 Cron で現フェーズ(`nutrition_targets.phase`)・目標レートに対する実レートのズレ → 新 `target_kcal` を提案。
  - 承認したら `nutrition_targets` に新 `date_from` 行(既存のフェーズ履歴設計に乗る)。
  - **遵守ゲート**: 計量/記録が薄い週(例3日以上欠測)は更新停止。推定補完は「推定」ラベル必須。
  - 提示は MCP トレーナーが会話で(「来週は+120kcal、根拠は…」)。
  - データ: `body_metrics`, `meal_items`, `daily_metrics.active_energy_kcal`, `nutrition_targets`(全て既存)。
- 参照: MacroFactor(適応型TDEE), Carbon Diet Coach(遵守ゲート), RP Diet(リバース)。

### 11. トレンド体重ライン + 来週予測 〔中〕
- 概要: 生スケール値の点 + 加重移動平均のトレンド線 + 来週トレンド体重の予測バンド。
- 設計:
  - 体重チャートにトレンド線重ね描画。⑩のTDEEから前方1点をレンジ予測(点予測は断定しない)。
  - 推定TDEEを別タブで時系列の細線(増量で上がった/減量で適応した を可視化)。
  - データ: `body_metrics` + ⑩のTDEE。React 描画のみ。
- 参照: MacroFactor(Expenditure トレンド)。

### 12. 前回超えプレフィル「これを超えろ」 〔低〕
- 概要: 毎セットが「前回の自分に勝つ」ミニゲーム。定着への効きが最大。
- 設計:
  - セットロガーのプレフィル横に `idx_sets_exercise_time` で引いた前回実績を「前回 60kg×8(RPE8)→ 超えろ」とゴースト表示。
  - 入力が前回を上回ったら行ハイライト。e1RM が上回れば「更新ペース」。RPEレス前回は控えめ。
  - データ: `workout_sets`(直近), `settings.e1rm_formula`(既存)。UI追加のみ。
- 参照: Setgraph(今日これを超えろ)。

### 13. RPE駆動の次回プログレッション提案(プログラム不要版) 〔中〕
- 概要: 前回のRPE+達成レップから次回の重量/レップを1案だけ提示。
- 設計:
  - ルール例: 全セット目標達成&最終RPE≤7 → +2.5kg / RPE8-9達成 → 同重量+1レップ / RPE10・failure頻発 → 据え置き or デロード候補。
  - RPE未入力なら提案せず e1RM推移だけ(推測値を出さない)。
  - 「提案」ラベル+根拠(前回RPE)を併記。テンプレ展開時に target 自動セット。MCPでも一貫提案。
  - データ: `workout_sets`(rpe/set_type/reps), `template_sets`(既存)。
- 参照: Boostcamp / JuggernautAI(RPE再較正)。

### 14. e1RM停滞検知 → デロード提案 〔大〕
- 概要: 同RPE帯でe1RMが5%低下 or 横ばい4週超 → デロード提案。
- 設計:
  - 主要種目の e1RM 確定値(`personal_records`/各セッション `e1rm_kg`)を時系列回帰。
  - 検知時は研究値で具体化(量50%減・強度E1RMの60-70%・RPE7上限・約6日)。RPEレス区間は信頼度↓。
  - Cron 週次検知 → MCPトレーナーが会話で/通知で。
  - データ: `personal_records`, `workout_sets`(rpe)(既存)。
- 参照: Bell et al. 2025(deload), RepXP/MyLiftingCoach。

### 15. 蛋白の食事間分配インサイト 〔低〕
- 概要: 「1日合計」でなく「何食に何g分配したか」(ロイシン閾値)。
- 設計:
  - `meals.logged_at` + `meal_items.protein_g` で1日タイムライン。各食 20-40g(≒0.4g/kg)到達か、3-4hおきに3-4回か。
  - 「夕食に90g偏り、朝8g。明朝に寄せると有利」等。研究レンジは参考値として明示(断定しない)。
  - データ: `meals`, `meal_items`, `body_metrics`(既存)。集計のみ。
- 参照: スポーツ栄養(Leucine threshold / protein distribution)。

### 16. 繊維・塩・糖 傾向ダッシュボード 〔低〕
- 概要: PFCの裏で崩れがちな指標の連続未達/超過ストリークを Today にサーフェス。
- 設計:
  - `meal_items` の fiber_g/sugar_g/sodium_mg を7日/30日移動平均 + 目標帯比較。
  - 「繊維14日連続未達」「塩 週平均+40%」を検出。微量栄養素(鉄/亜鉛)は**データが無いので非対象**。
  - データ: `meal_items`, `nutrition_targets`(既存)。
- 参照: Cronometer(ギャップ検出。ただし持っている指標だけに限定)。

---

## 17. Body Recap(四半期/年間)〔大・将来〕
- 概要: 週間Wrapped の長尺版。期間の総挙上・BIG3 e1RM推移・体重/体脂肪トレンド・最成長部位・ベスト食事写真・睡眠良化・「今四半期を一言で」(Claude命名)。
- 設計: 全期間データは D1 に蓄積済み。既存 `ShareImageModal` を長尺化。数値=集計値、比喩=LLM。

---

## あえてやらない(再提起防止)
- **微量栄養素84種(Cronometer級)** — データを持っていない → 捏造になる。非対象。
- **実績バッジ / 単純ストリーク** — 不要と判断済み。Gentler型「休養もOK」の思想は Readiness に吸収。
- **5/3/1等の固定プログラム** — スタイルに硬すぎ。RPEベースの「次回提案1案」(⑬)で代替。
- **偽の合成スコア(0-100)** — 実測主義に反する。信号+実測値+平常範囲で。

## 関連
- 既存設計: `docs/design.md`(§8.2 PR / §8.3 stimulus / §8.6 将来項目 / §12 cron・通知)、`docs/mcp-design.md`(ツールカタログ)。
- これらは未着手ストック。着手時は対象案を `docs/remaining-tasks.md` に移し、設計を design.md に昇格させる。

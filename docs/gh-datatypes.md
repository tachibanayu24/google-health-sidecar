# Google Health API v4 — dataType カタログ(権威的)

最終更新: 2026-06-03。

## 出典(これが真実 / SoT)

- **ディスカバリドキュメント**: `https://health.googleapis.com/$discovery/rest?version=v4`(Google API Discovery 形式, 約 252KB, 141 schemas)。**全 dataType と各フィールド形状の唯一の権威的定義**。
- 取得できる dataType の完全集合 = `ReconciledDataPoint` スキーマのプロパティ(= reconcile が返しうる型)。下表はそこから機械抽出 + 実機でデータ有無を確認したもの。
- **推測IDで probe するのは非推奨**(例: 体温を `body-temperature` で叩くと Invalid だが、正IDは `core-body-temperature`)。**必ず discovery doc / 本表の ID を使う**。`tools/probe-datatypes.ts` は個別のデータ有無確認用。

## SDK / クライアント

- 公式 SDK(`googleapis` npm など)は**この discovery doc から自動生成**されるが、依存が重く Cloudflare Workers には不向き。
- 本アプリは **自前 `GhClient`(生 `fetch`)** + `discovery-pin.ts`(使う型・verb・フィールドだけを手 pin)。全カタログは pin していなかった = 本表で補完。

## アーキテクチャ注意(重要)

- **Health Connect = Android 端末のオンデバイス API**。サーバ(Worker)からは**直接読めない**。
- 本アプリが pull するのは**クラウドの Google Health API**(`health.googleapis.com`)。だから「端末で Health Connect に何か入れた」≠「クラウド API で取れる」。**取れるのは「クラウド API が dataType を公開し、かつ自分のデータがクラウドに届いている」型だけ**。

## dataType 一覧(reconcile 可能な34種 + 状態)

凡例: ✅=使用中 / ◯=取得可・自分のデータ有(未使用) / △=取得可・データ0(供給元が未書込) / ✍=write専用(pull しない) / —=その他未使用。データ有無は 2026-06-03 実機確認。

| dataType ID | schema(値) | 状態 | メモ |
|---|---|---|---|
| `weight` | weight | ✅ | 体重 |
| `body-fat` | bodyFat | ✅ | 体脂肪率 |
| `sleep` | sleep | ✅ | 睡眠ステージ/効率 |
| `daily-resting-heart-rate` | dailyRestingHeartRate | ✅ | 安静時心拍 |
| `daily-heart-rate-variability` | dailyHeartRateVariability | ✅ | HRV(日次) |
| `daily-oxygen-saturation` | dailyOxygenSaturation | ✅ | SpO2(日次) |
| `daily-respiratory-rate` | dailyRespiratoryRate | ✅ | 呼吸数(日次) |
| `daily-vo2-max` | dailyVo2Max | ✅ | VO2max(日次) |
| `steps` | steps | ✅ | 歩数(interval→日次集計) |
| `active-energy-burned` | activeEnergyBurned | ✅ | 活動消費kcal(interval→日次集計) |
| **`daily-sleep-temperature-derivations`** | dailySleepTemperatureDerivations | **◯ データ有** | **皮膚温**(nightly℃ + baseline + 30日相対SD)。★readiness の優良材料。**設計の「皮膚温=恒久除外」は ID 違いの誤判定で、実は取得可**。 |
| **`blood-glucose`** | bloodGlucose | **◯ データ有** | 血糖(mg/dL, INTERSTITIAL_FLUID=CGM)。栄養/リコンプ分析に。 |
| **`hydration-log`** | hydrationLog | **◯ データ有** | 水分摂取(ml, interval) |
| `daily-heart-rate-zones` | dailyHeartRateZones | ◯ データ有 | 心拍ゾーン定義(LIGHT/MODERATE/VIGOROUS/PEAK) |
| `heart-rate` | heartRate | ◯ データ有 | intraday 心拍(bpm sample)。重い |
| `heart-rate-variability` | heartRateVariability | ◯ データ有 | HRV sample(rmssd)。日次版より細かい |
| `oxygen-saturation` | oxygenSaturation | ◯ データ有 | SpO2 sample。日次版より細かい |
| `height` | height | ◯ データ有 | 身長(静的) |
| `basal-energy-burned` | basalEnergyBurned | **△ データ0** | **BMR**。dataType は有るが供給元が未書込=実質取得不可(「BMR自前算出」の前提は変わらず) |
| `core-body-temperature` | coreBodyTemperature | △ データ0 | 深部体温。データ未供給 |
| `exercise` | exercise | ✍ | ワークアウト(D1→GH push 専用。pull しない=echo防止) |
| `nutrition-log` | nutritionLog | ✍ | 食事(D1→GH push 専用) |
| `active-minutes` / `active-zone-minutes` / `activity-level` | … | — | 活動量系。未使用 |
| `distance` / `floors` / `altitude` | … | — | 移動系。未使用(取得可) |
| `sedentary-period` / `time-in-heart-rate-zone` | … | — | 未使用 |
| `run-vo2-max` / `vo2-max` | … | — | VO2max の別形(日次版を使用中) |
| `respiratory-rate-sleep-summary` | … | — | 呼吸(日次版を使用中) |
| `swim-lengths-data` | … | — | 水泳。対象外 |

### ✗ API に存在しない(= Health Connect 連携でも取得不可)

- **血圧(blood-pressure)** — `BloodPressure` スキーマが discovery doc に**無い**。Health Connect 端末側には血圧があるが、クラウド GH API は公開していない → **サーバから取得不可**。
- 体温(`body-temperature`)・除脂肪量/骨量/体水分(lean/bone/water mass)・基礎代謝率名(`basal-metabolic-rate`)・総消費(`total-calories-burned`)・水分(`hydration` 単数)・栄養(`nutrition` 単数)— これらの ID は Invalid(正しくは上表の別ID、または非対応)。
- 合成スコア(readiness / recovery / stress / sleep-score)— **dataType として出さない**(生指標のみ)。readiness 等は当アプリで生指標から自前計算する。

## 設計への訂正メモ

- `docs/design.md` §5.4 / §17.5 の「皮膚温=恒久除外(候補8種すべて Invalid)」は、**`daily-skin-temperature` 等の誤ID**で probe した結論。正IDは **`daily-sleep-temperature-derivations`** で、**取得可 + データ有**。readiness 実装時に取り込む価値が高い。
- 「BMR は GH に無く自前算出」→ 正確には **dataType(`basal-energy-burned`)は有るがデータが来ていない**。供給元(Fitbit 等)が書き出せば取得可。

## 取り込むなら(優先候補)

1. **`daily-sleep-temperature-derivations`** — readiness の体温逸脱材料(baseline + 30日SD が既に付いてくる=個人ベースライン計算が楽)。
2. **`blood-glucose`** — CGM データ有。栄養/血糖変動の分析。
3. **`hydration-log`** — 水分。塩分との合わせ技。

いずれも既存の取り込みパターン(`discovery-pin.ts` の READ_DATATYPES 追加 + `mappers.ts` の抽出 + storage + 表示)で実装可能。

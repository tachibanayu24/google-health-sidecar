/**
 * dataType ID の妥当性プローブ(skin-temp / daily-steps の正IDを実機で確定)。
 * 各候補で reconcile(pageSize=1, filterなし)を投げ、200=有効 / 400 Invalid data type=無効 を判定。
 *   pnpm --filter @ghs/tools exec tsx probe-datatypes.ts
 */
import { GhClient } from '@ghs/core/providers/google-health/client';
import { ProviderApiError } from '@ghs/core/util/errors';
import { loadAccessToken } from './_token';

const token = await loadAccessToken();
const client = new GhClient(async () => token);

// 全 dataType の権威的カタログは docs/gh-datatypes.md(discovery doc 由来)を参照。
// ここは個別の「正ID + データ有無」確認用(推測IDで叩くと取りこぼすので doc のIDを使うこと)。
const CANDIDATES = ['active-energy-burned', 'basal-energy-burned', 'distance'];

// ── クラウド GH API(health.googleapis.com)dataType 在庫(2026-06-03 実機 probe)──
//  Health Connect は端末側 API でサーバから直接は読めない。Worker はクラウド GH を pull するので、
//  「クラウドが dataType を公開し、かつ自分のデータが届いている」ものだけ取得可能。
//  ✅ 有効(データ有): blood-glucose(CGM, mg/dL, INTERSTITIAL_FLUID)/ heart-rate(intraday bpm)/
//     oxygen-saturation(sample)/ heart-rate-variability(sample rmssd)/ height。
//  ✗ Invalid data type ID(=API非対応, 取得不可): blood-pressure / daily-blood-pressure /
//     body-temperature / basal-body-temperature / lean-body-mass / bone-mass / body-water-mass /
//     basal-metabolic-rate / total-calories-burned / floors-climbed / hydration / nutrition /
//     respiratory-rate(sample・ただし daily-respiratory-rate は有効)/ power /
//     readiness / recovery / stress / sleep-score(=合成スコアは出さない)。
//  → 血圧は本APIに存在しない(Health Connect連携でも不可)。血糖は取得可能で実データあり。

console.log('\n=== dataType ID probe ===\n');
for (const id of CANDIDATES) {
  try {
    const raw = (await client.reconcile(id, { pageSize: '3' })) as { dataPoints?: unknown[] };
    const n = raw.dataPoints?.length ?? 0;
    console.log(`✅ ${id} — 有効(${n} pts)`);
    if (n > 0) console.log(`   raw: ${JSON.stringify(raw.dataPoints?.[0]).slice(0, 600)}`);
  } catch (e) {
    if (e instanceof ProviderApiError) {
      const invalid = /Invalid data type/i.test(e.bodyText);
      console.log(
        `${invalid ? '✗' : '⚠'} ${id} — HTTP ${e.status}${invalid ? ' (Invalid data type ID)' : `: ${e.bodyText.slice(0, 80)}`}`,
      );
    } else {
      console.log(`⚠ ${id} — ${String(e).slice(0, 80)}`);
    }
  }
}
process.exit(0);

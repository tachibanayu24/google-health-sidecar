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

const CANDIDATES = [
  // 2026-06-02 確定: active-energy-burned / basal-energy-burned / distance が有効。形状確認。
  'active-energy-burned',
  'basal-energy-burned',
  'distance',
];

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

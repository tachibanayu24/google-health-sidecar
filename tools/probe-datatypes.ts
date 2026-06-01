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
  // 皮膚温
  'daily-skin-temperature',
  'skin-temperature',
  'daily-skin-temperature-deviation',
  'daily-skin-temperature-variation',
  'wrist-temperature',
  'daily-wrist-temperature',
  'body-temperature',
  'daily-body-temperature',
  // 歩数(日次集計型があるか)
  'daily-steps',
  'daily-step-count',
  'step-count',
];

console.log('\n=== dataType ID probe ===\n');
for (const id of CANDIDATES) {
  try {
    const raw = (await client.reconcile(id, { pageSize: '1' })) as { dataPoints?: unknown[] };
    const n = raw.dataPoints?.length ?? 0;
    console.log(`✅ ${id} — 有効(${n} pts in 1page)`);
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

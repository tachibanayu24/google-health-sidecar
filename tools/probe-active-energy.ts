/**
 * active-energy-burned の日次合計が実機で取れるか検証(pullActiveEnergyDaily と同じ読み取り)。
 *   pnpm --filter @ghs/tools exec tsx probe-active-energy.ts
 */
import { buildReadFilter, READ_DATATYPES } from '@ghs/core/providers/google-health/discovery-pin';
import { GoogleHealthProvider } from '@ghs/core/providers/google-health/provider';
import { toJstDateString } from '@ghs/core/util/date';
import { loadAccessToken } from './_token';

const token = await loadAccessToken();
const provider = new GoogleHealthProvider(async () => token);
const dt = READ_DATATYPES.find((d) => d.ghDataType === 'active-energy-burned');
if (!dt) throw new Error('active-energy-burned が READ_DATATYPES に無い');

const now = Math.floor(Date.now() / 1000);
const since = now - 3 * 86400;
const filter = buildReadFilter(dt, since, now);

const sums = new Map<string, number>();
let cursor: string | null = null;
let pts = 0;
do {
  const { points, cursor: next } = await provider.reconcileDataPoints(
    'active-energy-burned',
    filter,
    cursor,
  );
  for (const p of points) {
    if (p.value == null) continue;
    pts++;
    const d = toJstDateString((p.timeSec || now) * 1000);
    sums.set(d, (sums.get(d) ?? 0) + p.value);
  }
  cursor = next;
} while (cursor);

console.log(`\n=== active-energy-burned 日次合計(直近3日) interval pts=${pts} ===`);
for (const [d, t] of [...sums].sort()) console.log(`  ${d} → ${Math.round(t)} kcal`);
if (pts === 0) console.log('  (データ点 0 — GHにまだ無い or filter 不一致)');
process.exit(0);

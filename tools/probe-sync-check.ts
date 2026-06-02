/**
 * 2点を実機確認: (1) 睡眠が GH に在るか(直近3日の日付)、(2) reconcile の大きい pageSize を GH が許すか。
 *   pnpm --filter @ghs/tools exec tsx probe-sync-check.ts
 */
import { GhClient } from '@ghs/core/providers/google-health/client';
import {
  buildReadFilter,
  READ_DATATYPES,
} from '@ghs/core/providers/google-health/discovery-pin';
import { parseReconcileResponse } from '@ghs/core/providers/google-health/mappers';
import { toJstDateString } from '@ghs/core/util/date';
import { loadAccessToken } from './_token';

const token = await loadAccessToken();
const client = new GhClient(async () => token);
const now = Math.floor(Date.now() / 1000);

// (1) 睡眠: 直近3日に GH が何を返すか
const sleepDt = READ_DATATYPES.find((d) => d.ghDataType === 'sleep');
if (sleepDt) {
  const filter = buildReadFilter(sleepDt, now - 3 * 86400, now);
  const raw = await client.reconcile('sleep', { filter, pageSize: '50' });
  const parsed = parseReconcileResponse('sleep', raw);
  const dates = parsed.points.map((p) => toJstDateString((p.timeSec || now) * 1000)).sort();
  console.log(`\n[睡眠] GH 直近3日の睡眠データ点 = ${parsed.points.length}`);
  console.log(`  JST日付: ${dates.join(', ') || '(なし)'}`);
}

// (2) 大きい pageSize を GH が許すか(active-energy-burned で1ページの返却数を見る)
const aeDt = READ_DATATYPES.find((d) => d.ghDataType === 'active-energy-burned');
if (aeDt) {
  const filter = buildReadFilter(aeDt, now - 1 * 86400, now);
  for (const ps of ['100', '1000']) {
    const raw = (await client.reconcile('active-energy-burned', { filter, pageSize: ps })) as {
      dataPoints?: unknown[];
      nextPageToken?: string;
    };
    console.log(
      `\n[pageSize=${ps}] 1ページ返却数 = ${raw.dataPoints?.length ?? 0}, nextPageToken=${raw.nextPageToken ? 'あり' : 'なし'}`,
    );
  }
}
process.exit(0);

/**
 * M0 最優先ゲート(§5.2 / §14#1): GH nutrition-log write の実 grant を 200/403 で確認。
 *
 * 使い方(oauth:bootstrap 実行後ならトークンは自動読込・export 不要):
 *   pnpm --filter @ghs/tools oauth:check
 *
 * 結果で apps/web の vars FEATURE_GH_NUTRITION_PUSH を決める(200→true / 403→false 据置)。
 */

import { GhClient } from '@ghs/core/providers/google-health/client';
import { WRITE_DATATYPE } from '@ghs/core/providers/google-health/discovery-pin';
import {
  buildNutritionPayload,
  parseCreateResponse,
} from '@ghs/core/providers/google-health/mappers';
import { ProviderApiError } from '@ghs/core/util/errors';
import { loadAccessToken } from './_token';

const token = await loadAccessToken();
const client = new GhClient(async () => token);
const now = Math.floor(Date.now() / 1000);
const payload = buildNutritionPayload({
  atSec: now,
  mealType: 'SNACK',
  foodDisplayName: 'ghsidecar-write-probe',
  kcal: 1,
  proteinG: 0,
  clientTag: 'probe',
});

console.log('\n=== nutrition-log write probe ===');
try {
  const res = await client.createDataPoint(WRITE_DATATYPE.nutrition, payload);
  const { datapointId } = parseCreateResponse(res);
  console.log('✅ 200 OK — nutrition write は grant されています。');
  console.log('   → apps/web の vars FEATURE_GH_NUTRITION_PUSH を "true" に設定可能(§5.2)。');
  if (datapointId) {
    try {
      await client.batchDelete(WRITE_DATATYPE.nutrition, [datapointId]);
      console.log(`   (テストデータ ${datapointId} を batchDelete で掃除しました)`);
    } catch {
      console.log(`   ⚠ テストデータ ${datapointId} の掃除に失敗。GHアプリ側で手動削除を。`);
    }
  }
  process.exit(0);
} catch (e) {
  if (e instanceof ProviderApiError && (e.status === 403 || e.status === 401)) {
    console.log(`✗ ${e.status} — nutrition write は未 grant(§5.2 想定どおり)。`);
    console.log('   → FEATURE_GH_NUTRITION_PUSH は "false" 据置。D1正本で記録は失われない。');
    console.log('   → release notes に nutrition write 解禁が出るまで GH 食事 push は optional。');
    console.log(`   詳細: ${e.message}`);
    process.exit(0);
  }
  console.error('✗ 想定外のエラー:', e instanceof Error ? e.message : String(e));
  process.exit(1);
}

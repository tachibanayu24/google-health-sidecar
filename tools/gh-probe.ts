/**
 * GH read mapper の実データ検証(接続フェーズ #3, §17.4 openItems の最終確定)。
 *
 * 目的: discovery doc で pin した read マッパ(weight=weightGrams, daily=date+専用フィールド,
 * sleep=summary 等)が、実 reconcile レスポンスと一致するかを「生JSON」と「パース結果」を
 * 並べて目視確認する。ズレがあれば mappers.ts を直す。
 *
 * 使い方(oauth:bootstrap 実行後ならトークンは自動読込・export 不要):
 *   pnpm --filter @ghs/tools gh:probe
 *   (手動指定する場合は export GH_ACCESS_TOKEN=... も可)
 */
import { GhClient } from '@ghs/core/providers/google-health/client';
import { READ_DATATYPES } from '@ghs/core/providers/google-health/discovery-pin';
import { parseReconcileResponse } from '@ghs/core/providers/google-health/mappers';
import { ProviderApiError } from '@ghs/core/util/errors';
import { loadAccessToken } from './_token';

const token = loadAccessToken();
const client = new GhClient(async () => token);
const now = Math.floor(Date.now() / 1000);
const since = now - 30 * 24 * 60 * 60;
const rfc3339 = (s: number) => new Date(s * 1000).toISOString();

function preview(obj: unknown, n = 700): string {
  const s = JSON.stringify(obj);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

console.log('\n=== GH read probe (直近30日, reconcile) ===\n');

for (const dt of READ_DATATYPES) {
  const tag = `${dt.ghDataType}${dt.unverified ? ' (要検証ID)' : ''}`;
  try {
    const filter = `start_time >= "${rfc3339(since)}" AND start_time <= "${rfc3339(now)}"`;
    const raw = await client.reconcile(dt.ghDataType, { filter, pageSize: '5' });
    const parsed = parseReconcileResponse(dt.ghDataType, raw);
    console.log(`■ ${tag}`);
    console.log(`  raw   : ${preview(raw)}`);
    console.log(
      `  parsed: ${parsed.points.length} pts` +
        (parsed.points[0]
          ? ` | first = value:${parsed.points[0].value} timeSec:${parsed.points[0].timeSec}` +
            (parsed.points[0].extra ? ` extra:${JSON.stringify(parsed.points[0].extra)}` : '')
          : ' (空)'),
    );
    if (parsed.points[0] && parsed.points[0].value === null && dt.store.kind !== 'sleep') {
      console.log(
        '  ⚠ value=null: マッパのフィールド名が実レスポンスと不一致の可能性 → mappers.ts 要修正',
      );
    }
    console.log('');
  } catch (e) {
    const msg =
      e instanceof ProviderApiError ? `HTTP ${e.status}: ${e.bodyText.slice(0, 200)}` : String(e);
    console.log(`■ ${tag}\n  ✗ ${msg}\n`);
  }
}

console.log(
  '判定の見方: 各 dataType で parsed の value が非null・timeSec が妥当なら mapper はOK。' +
    '\nnull/HTTP4xx が出たら、raw の実フィールド名に合わせて mappers.ts(extractValue/extractTimeSec)を修正。',
);
process.exit(0);

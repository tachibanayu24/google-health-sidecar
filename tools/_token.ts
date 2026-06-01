import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** GH access_token を取得。env GH_ACCESS_TOKEN 優先、無ければ oauth:bootstrap が保存した .gh-tokens.json。 */
export function loadAccessToken(): string {
  const fromEnv = process.env.GH_ACCESS_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const path = fileURLToPath(new URL('./.gh-tokens.json', import.meta.url));
    const t = JSON.parse(readFileSync(path, 'utf8')) as { access_token?: string };
    if (t.access_token) return t.access_token;
  } catch {
    /* ファイル無し */
  }
  console.error(
    '✗ access_token が見つかりません。先に `pnpm --filter @ghs/tools oauth:bootstrap` を実行するか、' +
      'GH_ACCESS_TOKEN を export してください。',
  );
  process.exit(1);
}

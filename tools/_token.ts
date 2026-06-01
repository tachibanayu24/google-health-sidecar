import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { refreshAccessToken } from '@ghs/core/auth/googleOAuth';

/**
 * GH access_token を取得。優先順:
 *  1. env GH_ACCESS_TOKEN(手動指定)
 *  2. .gh-tokens.json の access_token(失効60s前まで有効ならそのまま)
 *  3. 失効していれば refresh_token + apps/web/.dev.vars のクライアント資格情報で自動更新し書き戻す
 * これで oauth:bootstrap は初回1回だけでよく、以降 probe/check は失効しても自走できる。
 */

const TOKENS_PATH = fileURLToPath(new URL('./.gh-tokens.json', import.meta.url));
const DEV_VARS_PATH = fileURLToPath(new URL('../apps/web/.dev.vars', import.meta.url));

interface Tokens {
  access_token?: string;
  refresh_token?: string | null;
  expires_at?: number; // unix 秒
}

/** apps/web/.dev.vars から 1 変数を読む(env が優先)。 */
function devVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    for (const line of readFileSync(DEV_VARS_PATH, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m?.[1] === name) return m[2]?.replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ファイル無し */
  }
  return undefined;
}

export async function loadAccessToken(): Promise<string> {
  if (process.env.GH_ACCESS_TOKEN) return process.env.GH_ACCESS_TOKEN;

  let t: Tokens = {};
  try {
    t = JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) as Tokens;
  } catch {
    /* ファイル無し */
  }

  const now = Math.floor(Date.now() / 1000);
  if (t.access_token && t.expires_at && now < t.expires_at - 60) return t.access_token;

  // 失効(または expires_at 不明)→ refresh_token で更新を試みる。
  if (t.refresh_token) {
    const clientId = devVar('GOOGLE_CLIENT_ID');
    const clientSecret = devVar('GOOGLE_CLIENT_SECRET');
    if (clientId && clientSecret) {
      try {
        const r = await refreshAccessToken({ clientId, clientSecret }, t.refresh_token);
        const next: Tokens = {
          access_token: r.access_token,
          refresh_token: r.refresh_token ?? t.refresh_token, // Google は通常 rotate しない
          expires_at: now + r.expires_in,
        };
        writeFileSync(TOKENS_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
        console.error('🔄 access_token を refresh_token で自動更新しました。');
        return r.access_token;
      } catch (e) {
        console.error('⚠ refresh 失敗:', e instanceof Error ? e.message : String(e));
      }
    } else {
      console.error('⚠ apps/web/.dev.vars に GOOGLE_CLIENT_ID/SECRET が無く自動更新できません。');
    }
  }

  if (t.access_token) return t.access_token; // 最後の手段(失効していれば 401 → 下記案内へ)

  console.error(
    '✗ access_token が見つかりません。`pnpm --filter @ghs/tools oauth:bootstrap` を実行するか、' +
      'GH_ACCESS_TOKEN を export してください。',
  );
  process.exit(1);
}

/**
 * GH OAuth 初回 bootstrap(Pattern B, §6.2 / §13 M0)。
 *
 * 使い方:
 *   # 認証情報は apps/web/.dev.vars(gitignore済)から自動読み込み。env で上書きも可。
 *   # nutrition.writeonly も要求するなら: export GH_NUTRITION_PUSH=1
 *   pnpm --filter @ghs/tools oauth:bootstrap
 *   → 表示されたURLをブラウザで開いて同意 → refresh_token を取得 → 表示の wrangler コマンドを実行。
 *
 * 事前に GCP の OAuth クライアント(Webアプリ)の「承認済みリダイレクトURI」に
 *   http://127.0.0.1:8788/oauth/callback
 * を登録し、同意画面を "In production" に publish しておくこと(7日失効回避, §6.2)。
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { buildAuthUrl, exchangeCode } from '@ghs/core/auth/googleOAuth';
import { ghScopeSet } from '@ghs/core/providers/scopes';

const PORT = 8788;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth/callback`;

/** apps/web/.dev.vars(KEY=VALUE)を読み、env 未設定のものだけ補う。 */
function loadDevVars(): void {
  try {
    const path = fileURLToPath(new URL('../apps/web/.dev.vars', import.meta.url));
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // .dev.vars が無ければ env のみ使用。
  }
}
loadDevVars();

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(
    '✗ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が見つかりません(apps/web/.dev.vars か env で指定)。',
  );
  process.exit(1);
}

const nutritionPush = process.env.GH_NUTRITION_PUSH === '1';
const scopes = ghScopeSet({ nutritionPush });
const state = crypto.randomUUID();
const authUrl = buildAuthUrl({ clientId, redirectUri: REDIRECT_URI, scopes, state });

console.log('\n=== GH OAuth bootstrap ===');
console.log(`scopes(${scopes.length}):\n  ${scopes.join('\n  ')}`);
console.log(`nutrition.writeonly: ${nutritionPush ? 'ON' : 'OFF (GH_NUTRITION_PUSH=1 で要求)'}`);
console.log('\n以下のURLをブラウザで開いて同意してください:\n');
console.log(authUrl);
console.log(`\n…${REDIRECT_URI} で待機中(Ctrl+C で中断)\n`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/oauth/callback') {
    res.writeHead(404).end('not found');
    return;
  }
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code || returnedState !== state) {
    res.writeHead(400).end('invalid code/state');
    console.error('✗ code/state 不一致。最初からやり直してください。');
    server.close();
    process.exit(1);
  }
  try {
    const token = await exchangeCode(
      { clientId, clientSecret },
      { code, redirectUri: REDIRECT_URI },
    );
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<h2>✅ 取得成功。ターミナルに戻ってください。</h2>');
    if (!token.refresh_token) {
      console.error(
        '\n✗ refresh_token が返りませんでした。同意画面の publish 状態 / prompt=consent / access_type=offline を確認(§6.2)。',
      );
      server.close();
      process.exit(1);
    }
    const expiresAt = Math.floor(Date.now() / 1000) + token.expires_in;
    console.log('\n✅ 取得成功。以下の wrangler コマンドで KV(TOKENS)へ投入してください:\n');
    const put = (k: string, v: string) =>
      `pnpm --filter @ghs/web exec wrangler kv key put --binding=TOKENS --remote "${k}" "${v}"`;
    console.log(put('gh:refresh_token', token.refresh_token));
    console.log(put('gh:access_token', token.access_token));
    console.log(put('gh:expires_at', String(expiresAt)));
    console.log(`\n付与スコープ: ${token.scope ?? '(不明)'}`);
    console.log(
      nutritionPush
        ? '\n→ 次に oauth:check で nutrition-log create の 200/403 を確認(§14#1)。'
        : '',
    );
    server.close();
    process.exit(0);
  } catch (e) {
    res.writeHead(500).end('exchange failed');
    console.error('✗ token 交換失敗:', e instanceof Error ? e.message : String(e));
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1');

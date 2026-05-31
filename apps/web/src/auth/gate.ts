import type { Context, Next } from 'hono';
import type { HonoEnv } from '../env';
import { readSessionToken, verifySession } from './session';

/**
 * 系統A ゲート(§6.1)。/api と UI を保護。
 * ローカル開発のみ DEV_AUTH_BYPASS=1 で素通し(.dev.vars 限定。本番 vars には絶対入れない)。
 */
export async function requireAuth(c: Context<HonoEnv>, next: Next): Promise<Response | undefined> {
  // dev bypass は localhost/127.0.0.1 からのリクエストに限定(本番ドメインに DEV_AUTH_BYPASS が
  // 万一漏れても素通しさせない二重ガード)。
  if (c.env.DEV_AUTH_BYPASS === '1' && isLocalHost(c.req.url)) {
    c.set('user', { sub: 'dev', email: c.env.ALLOWED_EMAIL });
    await next();
    return;
  }
  const token = readSessionToken(c.req.header('Cookie') ?? null);
  if (!token || !c.env.SESSION_SIGNING_KEY) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  const claims = await verifySession(token, c.env.SESSION_SIGNING_KEY);
  if (!claims || claims.email !== c.env.ALLOWED_EMAIL) {
    return c.json({ error: 'unauthorized' }, 403);
  }
  c.set('user', claims);
  await next();
  return;
}

function isLocalHost(reqUrl: string): boolean {
  const h = new URL(reqUrl).hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

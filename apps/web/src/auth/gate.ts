import type { Context, Next } from 'hono';
import type { HonoEnv } from '../env';
import { readSessionToken, verifySession } from './session';

/**
 * 系統A ゲート(§6.1)。/api と UI を保護。
 * ローカル開発のみ DEV_AUTH_BYPASS=1 で素通し(.dev.vars 限定。本番 vars には絶対入れない)。
 */
export async function requireAuth(c: Context<HonoEnv>, next: Next): Promise<Response | undefined> {
  if (c.env.DEV_AUTH_BYPASS === '1') {
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

import { exchangeCode } from '@ghs/core';
import { Hono } from 'hono';
import type { HonoEnv } from '../env';
import { clearSessionCookie, issueSession, sessionCookie, verifyGoogleIdToken } from './session';

/**
 * 系統A: Google OIDC ログイン(§6.1)。openid+email で本人だけ通す。
 * redirect_uri は現オリジン + /auth/callback(GCP に dev/prod 両方を登録要)。
 */
export const auth = new Hono<HonoEnv>();

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const STATE_COOKIE = 'ghs_oauth_state';

/**
 * redirect_uri は GCP 登録値と完全一致が必須。プロキシ環境で req オリジンが内部値になる事故を防ぐため、
 * `PUBLIC_ORIGIN`(vars)が設定されていればそれを優先し、無ければ req のオリジンにフォールバック(dev)。
 */
function redirectUri(c: { env: { PUBLIC_ORIGIN?: string }; req: { url: string } }): string {
  const origin = c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin;
  return `${origin.replace(/\/$/, '')}/auth/callback`;
}

/** http(ローカル)では Secure cookie が保存されないため、https のときだけ Secure を付ける。 */
function secureAttr(reqUrl: string): string {
  return new URL(reqUrl).protocol === 'https:' ? '; Secure' : '';
}

auth.get('/login', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.text('GOOGLE_CLIENT_ID 未設定', 500);
  const state = crypto.randomUUID();
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri(c));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email');
  u.searchParams.set('state', state);
  u.searchParams.set('prompt', 'select_account');
  c.header(
    'Set-Cookie',
    `${STATE_COOKIE}=${state}; HttpOnly${secureAttr(c.req.url)}; SameSite=Lax; Path=/; Max-Age=600`,
  );
  return c.redirect(u.toString(), 302);
});

auth.get('/callback', async (c) => {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    SESSION_SIGNING_KEY,
    ALLOWED_EMAIL,
    ALLOWED_SUB,
  } = c.env;
  const code = c.req.query('code');
  const state = c.req.query('state');
  const cookieState = readCookie(c.req.header('Cookie'), STATE_COOKIE);
  if (!code || !state || state !== cookieState) {
    return c.text('invalid state/code(やり直してください)', 400);
  }
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SESSION_SIGNING_KEY) {
    return c.text('OAuth secrets 未設定', 500);
  }
  try {
    const token = await exchangeCode(
      { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET },
      { code, redirectUri: redirectUri(c) },
    );
    if (!token.id_token) return c.text('id_token なし', 400);
    const claims = await verifyGoogleIdToken(token.id_token, {
      clientId: GOOGLE_CLIENT_ID,
      allowedEmail: ALLOWED_EMAIL,
      allowedSub: ALLOWED_SUB,
    });
    const jwt = await issueSession(claims, SESSION_SIGNING_KEY);
    const secure = new URL(c.req.url).protocol === 'https:';
    c.header('Set-Cookie', sessionCookie(jwt, { secure }), { append: true });
    c.header('Set-Cookie', `${STATE_COOKIE}=; Path=/; Max-Age=0`, { append: true });
    return c.redirect('/', 302);
  } catch (e) {
    return c.text(`ログイン失敗: ${e instanceof Error ? e.message : String(e)}`, 403);
  }
});

auth.get('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie());
  return c.redirect('/', 302);
});

function readCookie(header: string | undefined | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

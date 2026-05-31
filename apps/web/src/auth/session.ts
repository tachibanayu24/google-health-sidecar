import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

/**
 * 系統A: UIログインゲート(§6.1)。Google OIDC で本人(allowlist)だけ通す。
 * ID token を Google JWKS で検証 → 自前 HS256 セッションJWTを Cookie に。
 */
const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const SESSION_COOKIE = 'ghs_session';

export interface AllowGate {
  clientId: string;
  allowedEmail: string;
  allowedSub?: string;
}

export interface SessionClaims {
  sub: string;
  email: string;
}

/** Google ID token 検証 + allowlist 照合(iss/aud/exp + email/sub)。 */
export async function verifyGoogleIdToken(
  idToken: string,
  gate: AllowGate,
): Promise<SessionClaims> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUER,
    audience: gate.clientId,
  });
  const email = typeof payload.email === 'string' ? payload.email : '';
  const sub = payload.sub ?? '';
  if (payload.email_verified !== true) throw new Error('email_verified=false');
  if (email !== gate.allowedEmail) throw new Error('email not allowed');
  if (gate.allowedSub && sub !== gate.allowedSub) throw new Error('sub not allowed');
  return { sub, email };
}

function keyOf(signingKey: string): Uint8Array {
  return new TextEncoder().encode(signingKey);
}

/** 自前セッションJWT(HS256, 既定30日)。 */
export async function issueSession(
  claims: SessionClaims,
  signingKey: string,
  ttlSec = 30 * 24 * 60 * 60,
): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(keyOf(signingKey));
}

export async function verifySession(
  token: string,
  signingKey: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(signingKey));
    return {
      sub: payload.sub ?? '',
      email: typeof payload.email === 'string' ? payload.email : '',
    };
  } catch {
    return null;
  }
}

export function sessionCookie(
  token: string,
  opts: { secure?: boolean; ttlSec?: number } = {},
): string {
  const ttlSec = opts.ttlSec ?? 30 * 24 * 60 * 60;
  const secure = opts.secure === false ? '' : '; Secure';
  return `${SESSION_COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${ttlSec}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return v.join('=');
  }
  return null;
}

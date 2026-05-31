import { z } from 'zod';
import { ProviderAuthError } from '../util/errors';

/**
 * Google OAuth 2.0(系統B = GH API アクセス, Pattern B, §6.2)。
 * include_granted_scopes は使わない(legacy fitness.* union 回避)。
 */
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export const GoogleTokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(), // refresh では返らないことが多い(Googleは非rotate)
  scope: z.string().optional(),
  token_type: z.string(),
  id_token: z.string().optional(), // openid scope のとき
});
export type GoogleTokenResponse = z.infer<typeof GoogleTokenResponse>;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** 初回同意URL(offline + consent で refresh_token を確実に得る, §6.2)。 */
export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
}): string {
  const u = new URL(AUTH_ENDPOINT);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', opts.scopes.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'false'); // §6.2 重要
  u.searchParams.set('state', opts.state);
  return u.toString();
}

async function tokenRequest(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderAuthError(`Google token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  const parsed = GoogleTokenResponse.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new ProviderAuthError(`Unexpected token payload: ${text.slice(0, 300)}`);
  }
  return parsed.data;
}

export function exchangeCode(
  client: OAuthClient,
  opts: { code: string; redirectUri: string },
): Promise<GoogleTokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  );
}

export function refreshAccessToken(
  client: OAuthClient,
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  );
}

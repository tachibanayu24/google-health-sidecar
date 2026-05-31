import { nowSec } from '../util/date';
import { ProviderAuthError } from '../util/errors';
import { sleep } from '../util/rate-limit';
import { type GoogleTokenResponse, type OAuthClient, refreshAccessToken } from './googleOAuth';

/**
 * GH OAuth トークン保管(KV, Pattern B, §6.2)。失効60s前 lazy refresh。
 * 両Worker(web/mcp)共通で getAccessToken を使う。LOCK で二重refresh抑止、
 * 取得失敗側は待ちでなく再read(Google は非rotate なので二重refreshしても安全)。
 */
const K_ACCESS = 'gh:access_token';
const K_REFRESH = 'gh:refresh_token';
const K_EXPIRES = 'gh:expires_at';
const LOCK_KEY = 'gh:refresh_lock';
const REFRESH_SKEW_SEC = 60;
const LOCK_TTL_SEC = 30;

export interface TokenStoreEnv {
  TOKENS: KVNamespace;
  LOCK: KVNamespace;
  client: OAuthClient;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function readStored(tokens: KVNamespace): Promise<TokenBundle | null> {
  const [accessToken, refreshToken, expiresRaw] = await Promise.all([
    tokens.get(K_ACCESS),
    tokens.get(K_REFRESH),
    tokens.get(K_EXPIRES),
  ]);
  if (!refreshToken) return null;
  return {
    accessToken: accessToken ?? '',
    refreshToken,
    expiresAt: Number(expiresRaw ?? 0),
  };
}

async function persist(
  tokens: KVNamespace,
  resp: GoogleTokenResponse,
  issuedAtSec: number,
  prevRefresh: string,
): Promise<TokenBundle> {
  const expiresAt = issuedAtSec + resp.expires_in;
  const refreshToken = resp.refresh_token ?? prevRefresh; // Google は refresh で返さないことが多い
  await Promise.all([
    tokens.put(K_ACCESS, resp.access_token),
    tokens.put(K_EXPIRES, String(expiresAt)),
    ...(resp.refresh_token ? [tokens.put(K_REFRESH, resp.refresh_token)] : []),
  ]);
  return { accessToken: resp.access_token, refreshToken, expiresAt };
}

/** 初回 bootstrap(CLI / OAuth callback)でトークンを投入。 */
export async function storeInitialTokens(
  tokens: KVNamespace,
  resp: GoogleTokenResponse,
): Promise<void> {
  if (!resp.refresh_token) {
    throw new ProviderAuthError(
      'refresh_token が無い。access_type=offline + prompt=consent + 同意画面 In production publish を確認(§6.2)。',
    );
  }
  await persist(tokens, resp, nowSec(), resp.refresh_token);
}

/**
 * 有効な access_token を返す。失効60s前なら自動refresh。
 * 両Worker共通。LOCK 取得失敗側は短く待って再read。
 */
export async function getAccessToken(env: TokenStoreEnv): Promise<string> {
  const cur = await readStored(env.TOKENS);
  if (!cur) {
    throw new ProviderAuthError(
      'GH トークン未投入。tools/oauth-bootstrap で初回同意を踏み KV(TOKENS)へ投入を(§6.2)。',
    );
  }
  if (cur.accessToken && cur.expiresAt - REFRESH_SKEW_SEC > nowSec()) {
    return cur.accessToken;
  }

  // refresh が必要。LOCK を試みる。
  const locked = await acquireLock(env.LOCK);
  if (!locked) {
    // 別経路が refresh 中。少し待って再read(待ちすぎない)。
    await sleep(400);
    const again = await readStored(env.TOKENS);
    if (again?.accessToken && again.expiresAt - REFRESH_SKEW_SEC > nowSec()) {
      return again.accessToken;
    }
    // それでも古ければ自分で refresh(Google 非rotate なので二重でも安全, §6.2)。
  }
  try {
    const issuedAt = nowSec();
    const resp = await refreshAccessToken(env.client, cur.refreshToken);
    const next = await persist(env.TOKENS, resp, issuedAt, cur.refreshToken);
    return next.accessToken;
  } finally {
    if (locked) await env.LOCK.delete(LOCK_KEY);
  }
}

async function acquireLock(lock: KVNamespace): Promise<boolean> {
  // KV は CAS 非対応。単一ユーザー低並行なので best-effort(get→put)。
  const held = await lock.get(LOCK_KEY);
  if (held) return false;
  await lock.put(LOCK_KEY, String(nowSec()), { expirationTtl: LOCK_TTL_SEC });
  return true;
}

/** GhClient へ渡す getToken(クロージャ)。 */
export function makeGetToken(env: TokenStoreEnv): () => Promise<string> {
  return () => getAccessToken(env);
}

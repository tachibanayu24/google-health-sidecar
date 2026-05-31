import type { OAuthClient } from '../auth/googleOAuth';
import { makeGetToken } from '../auth/tokenStore';
import { Db } from '../db/client';
import { GoogleHealthProvider } from '../providers/google-health/provider';
import type { HealthProvider } from '../providers/HealthProvider';

/**
 * services 層の共有コンテキスト(§8.5: 全write一点経由)。
 * apps(web/mcp)が自身の Env から構築して渡す薄いアダプタ。
 */
export interface AppContext {
  db: Db;
  tokens: KVNamespace;
  lock: KVNamespace;
  cache?: KVNamespace;
  oauth: OAuthClient;
  /** §5.2 nutrition write の feature flag。 */
  featureGhNutritionPush: boolean;
  /** GH push を同期で試すか(既定 true。失敗は best-effort で握り潰し)。 */
  pushInline?: boolean;
}

/** GH バインディングから AppContext を組む(D1/KV/secrets)。 */
export function makeContext(env: {
  DB: D1Database;
  TOKENS: KVNamespace;
  LOCK: KVNamespace;
  CACHE?: KVNamespace;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FEATURE_GH_NUTRITION_PUSH?: string;
}): AppContext {
  return {
    db: new Db(env.DB),
    tokens: env.TOKENS,
    lock: env.LOCK,
    cache: env.CACHE,
    oauth: { clientId: env.GOOGLE_CLIENT_ID ?? '', clientSecret: env.GOOGLE_CLIENT_SECRET ?? '' },
    featureGhNutritionPush: env.FEATURE_GH_NUTRITION_PUSH === 'true',
    pushInline: true,
  };
}

/** 既定 provider(GoogleHealthProvider, §5.6)。両Worker共通 getAccessToken でトークン解決。 */
export function getProvider(ctx: AppContext): HealthProvider {
  return new GoogleHealthProvider(
    makeGetToken({ TOKENS: ctx.tokens, LOCK: ctx.lock, client: ctx.oauth }),
  );
}

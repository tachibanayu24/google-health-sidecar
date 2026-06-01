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
  /** provider 注入(テストで fake / Fitbit 切替 / MCP 再利用)。未設定なら getProvider が既定を遅延生成。 */
  provider?: HealthProvider;
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

/** provider を返す。ctx.provider が注入済ならそれを、無ければ既定 GoogleHealthProvider を遅延生成しキャッシュ。 */
export function getProvider(ctx: AppContext): HealthProvider {
  if (!ctx.provider) {
    ctx.provider = new GoogleHealthProvider(
      makeGetToken({ TOKENS: ctx.tokens, LOCK: ctx.lock, client: ctx.oauth }),
    );
  }
  return ctx.provider;
}

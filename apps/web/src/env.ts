/** apps/web の Worker バインディング(wrangler.jsonc と対応)。 */
export interface Env {
  // D1 / KV
  DB: D1Database;
  TOKENS: KVNamespace;
  CACHE: KVNamespace;
  LOCK: KVNamespace;
  // vars
  ALLOWED_EMAIL: string;
  FEATURE_GH_NUTRITION_PUSH: string;
  /** 本番の公開オリジン(OAuth redirect_uri を固定。未設定ならリクエストオリジン)。 */
  PUBLIC_ORIGIN?: string;
  // secrets(wrangler secret put / .dev.vars)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SIGNING_KEY?: string;
  ALLOWED_SUB?: string;
  /** ローカル開発のみ。.dev.vars 限定で本番 vars には入れない(§6.1)。 */
  DEV_AUTH_BYPASS?: string;
}

/** Hono のジェネリック(Bindings + ログインユーザー)。 */
export type HonoEnv = {
  Bindings: Env;
  Variables: { user: { sub: string; email: string } };
};

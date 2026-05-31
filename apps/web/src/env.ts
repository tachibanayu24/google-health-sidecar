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
  // secrets(wrangler secret put / .dev.vars)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SIGNING_KEY?: string;
  ALLOWED_SUB?: string;
}

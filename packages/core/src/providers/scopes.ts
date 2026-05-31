/**
 * Google Health API v4 スコープ(§6.2)。read/write を .readonly/.writeonly で分割。
 * include_granted_scopes は使わない(legacy fitness.* union で mixed-scope reject 回避, §6.2)。
 */
const BASE = 'https://www.googleapis.com/auth/googlehealth';

export const GH_SCOPES = {
  // write
  activityWrite: `${BASE}.activity_and_fitness.writeonly`,
  nutritionWrite: `${BASE}.nutrition.writeonly`, // ★flag付き(§5.2 要検証)
  metricsWrite: `${BASE}.health_metrics_and_measurements.writeonly`,
  // read
  activityRead: `${BASE}.activity_and_fitness.readonly`,
  nutritionRead: `${BASE}.nutrition.readonly`,
  metricsRead: `${BASE}.health_metrics_and_measurements.readonly`,
  sleepRead: `${BASE}.sleep.readonly`,
} as const;

/** OIDC ログイン(系統A)用の最小スコープ。 */
export const OIDC_SCOPES = ['openid', 'email'] as const;

/** Pattern B(系統B)で要求するスコープ集合。nutritionWrite は flag に応じて足す。 */
export function ghScopeSet(opts: { nutritionPush: boolean }): string[] {
  const s: string[] = [
    GH_SCOPES.activityWrite,
    GH_SCOPES.metricsWrite,
    GH_SCOPES.activityRead,
    GH_SCOPES.metricsRead,
    GH_SCOPES.sleepRead,
  ];
  if (opts.nutritionPush) s.push(GH_SCOPES.nutritionWrite);
  return s;
}

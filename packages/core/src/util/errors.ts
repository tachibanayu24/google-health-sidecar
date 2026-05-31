/**
 * プロバイダ非依存のエラー型(GH/Fitbit 共通)。MCP の toolError 整形にも使う。
 */

export class ProviderAuthError extends Error {
  readonly code = 'provider_auth_error' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

export class ProviderApiError extends Error {
  readonly code = 'provider_api_error' as const;
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    public readonly endpoint?: string,
  ) {
    super(`Provider API ${status} at ${endpoint ?? '<unknown>'}: ${bodyText.slice(0, 240)}`);
    this.name = 'ProviderApiError';
  }
}

export class RateLimitError extends Error {
  readonly code = 'rate_limit_error' as const;
  constructor(
    public readonly retryAfterSec: number,
    public readonly endpoint?: string,
  ) {
    super(`Rate limit exceeded at ${endpoint ?? '<unknown>'} (Retry-After: ${retryAfterSec}s)`);
    this.name = 'RateLimitError';
  }
}

/** バリデーション/ドメイン制約違反。 */
export class DomainError extends Error {
  readonly code = 'domain_error' as const;
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

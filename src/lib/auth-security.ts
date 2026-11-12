export const AUTH_TTL_SECONDS = 8 * 60 * 60;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

type AttemptState = { failures: number[] };

export class LoginRateLimiter {
  private readonly attempts = new Map<string, AttemptState>();

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const normalized = key.trim().toLowerCase();
    const state = this.attempts.get(normalized);
    if (!state) return { allowed: true, retryAfterSeconds: 0 };
    state.failures = state.failures.filter((at) => now - at < LOGIN_WINDOW_MS);
    if (state.failures.length === 0) {
      this.attempts.delete(normalized);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const oldest = state.failures[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + LOGIN_WINDOW_MS - now) / 1000));
    return {
      allowed: state.failures.length < LOGIN_FAILURE_LIMIT,
      retryAfterSeconds: state.failures.length < LOGIN_FAILURE_LIMIT ? 0 : retryAfterSeconds,
    };
  }

  recordFailure(key: string, now = Date.now()): void {
    const normalized = key.trim().toLowerCase();
    const checked = this.check(normalized, now);
    if (!checked.allowed) return;
    const state = this.attempts.get(normalized) ?? { failures: [] };
    state.failures.push(now);
    this.attempts.set(normalized, state);
    // Bound memory if a public endpoint receives many distinct usernames.
    if (this.attempts.size > 10_000) {
      const firstKey = this.attempts.keys().next().value;
      if (firstKey) this.attempts.delete(firstKey);
    }
  }

  reset(key: string): void {
    this.attempts.delete(key.trim().toLowerCase());
  }
}

// In-process throttling is a defence-in-depth measure. Deployments with multiple
// instances should additionally enforce an edge/WAF or shared-store rate limit.
export const loginRateLimiter = new LoginRateLimiter();

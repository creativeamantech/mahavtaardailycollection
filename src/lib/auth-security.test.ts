import { describe, expect, test } from "bun:test";
import { AUTH_TTL_SECONDS, LoginRateLimiter, LOGIN_FAILURE_LIMIT, LOGIN_WINDOW_MS } from "./auth-security";

describe("authentication security controls", () => {
  test("limits sessions to eight hours", () => {
    expect(AUTH_TTL_SECONDS).toBe(8 * 60 * 60);
  });

  test("blocks after five failed PIN attempts", () => {
    const limiter = new LoginRateLimiter();
    const start = 1_800_000_000_000;
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) limiter.recordFailure("Admin", start + i);
    const result = limiter.check("admin", start + LOGIN_FAILURE_LIMIT);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("unblocks after the rolling 15-minute window expires", () => {
    const limiter = new LoginRateLimiter();
    const start = 1_800_000_000_000;
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) limiter.recordFailure("Admin", start + i);
    expect(limiter.check("Admin", start + LOGIN_WINDOW_MS + 1).allowed).toBe(true);
  });

  test("successful login reset clears the failed-attempt counter", () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) limiter.recordFailure("Admin");
    limiter.reset("ADMIN");
    expect(limiter.check("Admin").allowed).toBe(true);
  });

  test("tracks attempts independently for each account", () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) limiter.recordFailure("Admin");
    expect(limiter.check("Aarti").allowed).toBe(true);
  });
});

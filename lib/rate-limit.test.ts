import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "./rate-limit-core";

/**
 * Unit tests for the sliding-window rate limiter (Task 23 — none existed
 * before this pass). Imports from ./rate-limit-core (not ./rate-limit)
 * because ./rate-limit imports "server-only", which throws unconditionally
 * on import outside Next's server-bundling context — see the comment atop
 * lib/rate-limit-core.ts. `checkRateLimit` is pure aside from its
 * module-level Map, so we drive it with fake timers and distinct keys per
 * test to avoid cross-test interference from that shared state.
 */
describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows submissions up to the limit within the window", () => {
    const key = "test:within-limit";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 15 * 60 * 1000).allowed).toBe(true);
    }
  });

  it("blocks the submission that exceeds the limit", () => {
    const key = "test:exceeds-limit";
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 15 * 60 * 1000);
    }
    const result = checkRateLimit(key, 5, 15 * 60 * 1000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("does not consume an attempt slot when blocked (retry-after keeps counting from the oldest attempt)", () => {
    const key = "test:retry-after-value";
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 15 * 60 * 1000);
    }
    const first = checkRateLimit(key, 5, 15 * 60 * 1000);
    const second = checkRateLimit(key, 5, 15 * 60 * 1000);
    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
    // retryAfterMs should stay pinned to the oldest attempt aging out, not
    // reset forward just because more blocked attempts came in.
    expect(second.retryAfterMs).toBeLessThanOrEqual(first.retryAfterMs!);
  });

  it("allows again once the oldest attempts age out of the window", () => {
    const key = "test:window-slides";
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 15 * 60 * 1000);
    }
    expect(checkRateLimit(key, 5, 15 * 60 * 1000).allowed).toBe(false);

    // Advance past the 15-minute window.
    vi.setSystemTime(new Date("2026-07-15T12:15:01Z"));

    expect(checkRateLimit(key, 5, 15 * 60 * 1000).allowed).toBe(true);
  });

  it("tracks separate keys independently", () => {
    const keyA = "test:key-a";
    const keyB = "test:key-b";
    for (let i = 0; i < 5; i++) {
      checkRateLimit(keyA, 5, 15 * 60 * 1000);
    }
    expect(checkRateLimit(keyA, 5, 15 * 60 * 1000).allowed).toBe(false);
    expect(checkRateLimit(keyB, 5, 15 * 60 * 1000).allowed).toBe(true);
  });

  it("only counts attempts within a partially-elapsed window, not the whole history", () => {
    const key = "test:partial-window";
    // 3 attempts at t=0
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, 5, 15 * 60 * 1000);
    }
    // Advance 10 minutes (still within the 15-minute window for those 3).
    vi.setSystemTime(new Date("2026-07-15T12:10:00Z"));
    // 2 more attempts — total 5 within the window, at the limit but not over.
    for (let i = 0; i < 2; i++) {
      expect(checkRateLimit(key, 5, 15 * 60 * 1000).allowed).toBe(true);
    }
    // A 6th attempt now should be blocked.
    expect(checkRateLimit(key, 5, 15 * 60 * 1000).allowed).toBe(false);
  });
});

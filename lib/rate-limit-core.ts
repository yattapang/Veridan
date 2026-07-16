/**
 * Pure sliding-window rate-limiter core, split out from lib/rate-limit.ts
 * (Task 23) so it can be unit-tested directly. lib/rate-limit.ts imports
 * "server-only", and the real "server-only" package throws unconditionally
 * on import outside of Next.js's server-component bundling (it has no
 * environment check — see node_modules/server-only/index.js) — it only
 * behaves as a no-op because Next's bundler aliases it away for server
 * files. Vitest has no such alias, so a test importing lib/rate-limit.ts
 * directly would crash at module load. This file has no "server-only" or
 * "next/headers" import, so it's safe to import from tests and from
 * lib/rate-limit.ts alike.
 */

const submissionLog = new Map<string, number[]>();

/**
 * Returns true if `key` is currently within its allowed submission rate,
 * and records this attempt. Call once per submission attempt.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  const existing = submissionLog.get(key) ?? [];
  const withinWindow = existing.filter((ts) => ts > windowStart);

  if (withinWindow.length >= limit) {
    const oldestInWindow = Math.min(...withinWindow);
    submissionLog.set(key, withinWindow);
    return { allowed: false, retryAfterMs: oldestInWindow + windowMs - now };
  }

  withinWindow.push(now);
  submissionLog.set(key, withinWindow);
  return { allowed: true };
}

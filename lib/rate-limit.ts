import "server-only";
import { headers } from "next/headers";

/**
 * Per-IP sliding-window rate limiter, in-memory.
 *
 * LIMITATION (flagged per Task 8 build plan instruction): this Map lives in
 * the Node.js process's memory. It works correctly for Phase 1 because
 * Vercel Hobby/Pro deployments of a small app like this typically run a
 * single active serverless instance for a given route under light load, and
 * because losing the counters on a cold start / redeploy only ever makes
 * the limiter *more* permissive, never less (fails open, not closed). It
 * does NOT correctly rate-limit across multiple concurrent instances (each
 * instance has its own Map) or across a fleet/CDN edge cache, and every
 * cold start silently resets everyone's count. If real spam volume shows
 * this is insufficient, replace with a shared store (Upstash Redis / Vercel
 * KV) — the build plan's own §4 Task 8 row notes this as the alternative.
 */
const submissionLog = new Map<string, number[]>();

/** Best-effort client IP from standard proxy headers (Vercel sets these). */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) {
    // x-forwarded-for can be a comma-separated chain; the first entry is
    // the original client.
    return forwardedFor.split(",")[0]!.trim();
  }
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

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

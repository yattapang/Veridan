import "server-only";
import { headers } from "next/headers";

export { checkRateLimit } from "./rate-limit-core";

/**
 * LIMITATION (flagged per Task 8 build plan instruction): the sliding-window
 * counters in ./rate-limit-core live in the Node.js process's memory. It
 * works correctly for Phase 1 because Vercel Hobby/Pro deployments of a
 * small app like this typically run a single active serverless instance for
 * a given route under light load, and because losing the counters on a cold
 * start / redeploy only ever makes the limiter *more* permissive, never
 * less (fails open, not closed). It does NOT correctly rate-limit across
 * multiple concurrent instances (each instance has its own Map) or across a
 * fleet/CDN edge cache, and every cold start silently resets everyone's
 * count. If real spam volume shows this is insufficient, replace with a
 * shared store (Upstash Redis / Vercel KV) — the build plan's own §4 Task 8
 * row notes this as the alternative.
 */

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

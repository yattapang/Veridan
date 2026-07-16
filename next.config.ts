import type { NextConfig } from "next";

/**
 * Security headers (Task 26 production hardening). Kept deliberately
 * minimal/safe so it never breaks Next's own hydration/RSC payloads or
 * Supabase Auth (cookies, redirects) — no CSP `script-src` restriction is
 * set here, since a strict CSP needs per-build nonce wiring that's out of
 * scope for this pass; framing/clickjacking and MIME-sniffing protection
 * are the concrete wins below.
 */
const securityHeaders = [
  // Prevents the browser from being embedded in a frame/iframe on another
  // origin (clickjacking protection). Belt-and-braces with the
  // `frame-ancestors` CSP directive below, since X-Frame-Options is the
  // older/more broadly-supported mechanism.
  { key: "X-Frame-Options", value: "DENY" },
  // Stops browsers from MIME-sniffing a response away from its declared
  // Content-Type (e.g. treating an uploaded file as executable script).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Sends the full referrer only on same-origin requests; cross-origin
  // requests get origin-only (never the full path/query, which could leak
  // quote refs or internal admin paths to a third-party destination).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Minimal CSP: only blocks framing (redundant with X-Frame-Options for
  // older browsers) — intentionally does NOT restrict script-src/style-src
  // etc., since Next's inline hydration scripts and Tailwind's injected
  // styles would need a nonce-based setup this pass doesn't include.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Disables browser features this app never uses, reducing attack surface
  // for embedded third-party content (none currently, but cheap to set).
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

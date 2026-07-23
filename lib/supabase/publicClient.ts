import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-free, stateless ANON-role Supabase client for reading genuinely
 * public data (e.g. `site_content`, gated by the `site_content_anon_select`
 * RLS policy).
 *
 * Why this exists separately from `lib/supabase/server.ts`'s `createClient()`:
 * that client binds to the request via `cookies()`, and calling `cookies()`
 * anywhere in a route's render tree forces Next to render the WHOLE route
 * dynamically — even for public, session-independent data. Reading
 * `site_content` through a cookie-bound client in the shared marketing layout
 * (SiteFooter) therefore silently turned the entire marketing site from
 * statically prerendered to server-rendered-per-request (Phase 3A review
 * MAJOR-1). Because every `site_content` row is public and identical for
 * every visitor (anon and founder alike), the read needs no session, so this
 * cookie-free client lets `unstable_cache` + `revalidateTag` deliver ISR while
 * the marketing routes stay statically prerenderable.
 *
 * Anon key, RLS-enforced — NOT the service role. Server-only; never import
 * from a client component.
 */
export function createPublicContentClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase environment variables are not set. Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return createSupabaseClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

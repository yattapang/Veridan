import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — BYPASSES Row Level Security.
 *
 * Server-only (enforced via the `server-only` package): use exclusively
 * in Route Handlers / server code that must act with elevated privileges
 * (e.g. reading enquiries submitted anonymously, admin mutations).
 * Never import from client components.
 *
 * No session persistence — this is a stateless service client.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin environment variables are not set. Fill in NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side only)."
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

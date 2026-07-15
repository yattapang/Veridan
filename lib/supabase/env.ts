/**
 * Cheap, synchronous check for whether the Supabase env vars are present.
 * Used by pages that need to decide *before* rendering a form whether to
 * show a "temporarily unavailable" message, without needing an async
 * `createClient()` call (and its try/catch) just to render a static form.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

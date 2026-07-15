import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Signed-URL helper for the private `enquiry-uploads` bucket (Task 13).
 * Founders are `authenticated`, which has full CRUD on the bucket per
 * supabase/migrations/20260713000002_rls.sql, so a signed URL generated
 * from a founder's own session works without a service-role client.
 * Best-effort: a failed signing (e.g. object since deleted, or Storage not
 * configured) yields `url: null` for that path rather than failing the
 * whole page render.
 */
export async function signEnquiryFileUrls(
  supabase: SupabaseClient,
  paths: string[] | null | undefined,
  expiresInSeconds = 60 * 60
): Promise<{ path: string; url: string | null }[]> {
  if (!paths || paths.length === 0) return [];

  return Promise.all(
    paths.map(async (path) => {
      try {
        const { data, error } = await supabase.storage
          .from("enquiry-uploads")
          .createSignedUrl(path, expiresInSeconds);
        if (error || !data) return { path, url: null };
        return { path, url: data.signedUrl };
      } catch {
        return { path, url: null };
      }
    })
  );
}

/** Trims a Storage path down to its filename for display. */
export function fileNameFromPath(path: string): string {
  const parts = path.split("/");
  const last = parts[parts.length - 1] ?? path;
  // Uploaded paths are `${pathway}/${timestamp}-${safeName}` — drop the
  // timestamp prefix for a friendlier label.
  return last.replace(/^\d+-/, "");
}

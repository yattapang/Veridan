import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDownloadable } from "./visibility";

export type GatedCatalogueAssetKind = "file" | "thumbnail";

export type GatedCatalogueSignResult =
  | { ok: true; url: string; filename: string | null }
  | { ok: false; status: 404 | 500; error: string };

/**
 * THE §3.3 guardrail, centralized so both app/api/catalogue/[id]/download
 * and app/api/catalogue/[id]/thumbnail share one code path and can never
 * drift apart: re-reads catalogue_documents.visibility LIVE via the
 * service-role client (must be lib/supabase/admin.ts's createAdminClient(),
 * never the request-scoped anon/cookie client) on every single call — never
 * a cached or earlier-selected row — and issues a short-lived (60s) signed
 * Storage URL only if visibility is 'public' at that exact moment.
 *
 * A document that has since been flipped back to Internal 404s immediately,
 * even against a previously-obtained link — there is no window where an
 * old link keeps working (Plan §3.3 / founder UAT §6.3 item 4). A 404 is
 * used rather than 403 for a non-public document deliberately: the response
 * for "exists but is internal" and "doesn't exist at all" must be
 * indistinguishable, so an unauthenticated caller can never use this route
 * to enumerate which internal documents exist.
 */
export async function signPublicCatalogueAsset(
  admin: SupabaseClient,
  documentId: string,
  kind: GatedCatalogueAssetKind
): Promise<GatedCatalogueSignResult> {
  const { data, error } = await admin
    .from("catalogue_documents")
    .select("visibility, file_storage_path, thumbnail_storage_path, original_filename")
    .eq("id", documentId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 404, error: "Document not found." };
  }
  if (!isDownloadable(data)) {
    return { ok: false, status: 404, error: "Document not found." };
  }

  const path = kind === "file" ? data.file_storage_path : data.thumbnail_storage_path;
  if (!path) {
    return { ok: false, status: 404, error: "No file available." };
  }

  const { data: signed, error: signError } = await admin.storage
    .from("catalogue-files")
    .createSignedUrl(path, 60);
  if (signError || !signed) {
    return { ok: false, status: 500, error: "Could not generate a download link." };
  }

  return { ok: true, url: signed.signedUrl, filename: data.original_filename };
}

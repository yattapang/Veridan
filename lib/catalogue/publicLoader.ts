import "server-only";

import { unstable_cache } from "next/cache";
// Cookie-FREE anon client on purpose — same reasoning as
// lib/site-content-db/loader.ts and lib/articles/publicLoader.ts (Phase 3A
// review MAJOR-1): a cookie-bound client forces the whole route to render
// dynamically. The public catalogue browse page is identical for every
// visitor, so this keeps app/(marketing)/catalogue statically prerenderable
// while unstable_cache + revalidateTag (called from
// app/admin/catalogue/actions.ts) handle freshness.
import { createPublicContentClient } from "@/lib/supabase/publicClient";
import type { CatalogueDocumentRow } from "@/lib/supabase/types";

/**
 * The subset of columns the public browse page ever needs. Deliberately
 * excludes `uploaded_by` and `supplier_id` (internal provenance, no public
 * value). Including `file_storage_path`/`thumbnail_storage_path` as plain
 * strings is safe per the migration's guardrail note: the anon role has no
 * Storage grant on `catalogue-files`, so a path string alone grants no
 * access — but the PUBLIC PAGE ITSELF never uses these paths to build a
 * direct Storage URL. Every download/thumbnail link routes through the
 * gated API routes (Plan §3.5: "never a direct Storage URL"); the raw path
 * fields exist on this type only because the RLS-scoped row includes them,
 * not because any component reads them directly.
 */
export type PublicCatalogueDocument = Pick<
  CatalogueDocumentRow,
  | "id"
  | "brand"
  | "category"
  | "title"
  | "description"
  | "original_filename"
  | "file_size_bytes"
  | "thumbnail_storage_path"
  | "published_at"
>;

const PUBLIC_CATALOGUE_COLUMNS =
  "id, brand, category, title, description, original_filename, file_size_bytes, thumbnail_storage_path, published_at";

/**
 * Public (visibility = 'public') catalogue documents, brand then title order.
 * Relies on `catalogue_documents_anon_select_public` (RLS) as the actual
 * enforcement — an internal document simply doesn't come back here, the same
 * defense-in-depth posture as getPublishedArticles(). Tagged `catalogue:list`
 * — every mutating admin action calls revalidateTag('catalogue:list').
 */
export async function getPublicCatalogueDocuments(): Promise<PublicCatalogueDocument[]> {
  let supabase;
  try {
    supabase = createPublicContentClient();
  } catch {
    return [];
  }

  const cached = unstable_cache(
    async () => {
      const { data, error } = await supabase
        .from("catalogue_documents")
        .select(PUBLIC_CATALOGUE_COLUMNS)
        .eq("visibility", "public")
        .order("brand", { ascending: true })
        .order("title", { ascending: true });
      if (error || !data) return [];
      return data as PublicCatalogueDocument[];
    },
    ["catalogue", "list"],
    { tags: ["catalogue:list"], revalidate: 3600 }
  );

  return cached();
}

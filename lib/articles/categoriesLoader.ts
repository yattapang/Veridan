import "server-only";

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
// Cookie-FREE anon client on purpose — same reasoning as
// lib/articles/publicLoader.ts / lib/site-content-db/loader.ts: a
// cookie-bound client would force the whole /articles route to render
// dynamically. Only getManagedArticleCategories (the public-page path)
// uses this; getManagedArticleCategoriesForEditor takes an already-created
// authenticated client instead (the admin editor is never statically
// prerendered, so there's no such constraint there).
import { createPublicContentClient } from "@/lib/supabase/publicClient";
import { SUGGESTED_ARTICLE_CATEGORIES } from "./categories";
import type { ArticleCategoryRow } from "@/lib/supabase/types";

export type ManagedArticleCategory = Pick<
  ArticleCategoryRow,
  "id" | "name" | "slug" | "description" | "sort_order"
>;

const SELECT_COLUMNS = "id, name, slug, description, sort_order";

/**
 * Fallback rows derived from the lib/articles/categories.ts constant, used
 * only when article_categories is unreachable or empty — same
 * DB-with-hardcoded-fallback discipline as lib/site-content-db/loader.ts.
 * `id` is synthesized (there's no database row) but stable across calls,
 * which is all a React `key` or a <select> option value needs.
 */
const FALLBACK_CATEGORIES: ManagedArticleCategory[] = SUGGESTED_ARTICLE_CATEGORIES.map((c) => ({
  id: `fallback-${c.slug}`,
  name: c.name,
  slug: c.slug,
  description: c.description,
  sort_order: c.sort_order,
}));

/**
 * Managed article categories, ordered by sort_order — for the PUBLIC
 * /articles page only (lib/articles/categoryAdmin.ts's
 * orderCategoriesForPublicFilter uses this to order the category filter
 * chips). Cookie-free + unstable_cache so /articles stays statically
 * prerenderable (Plan §2.5 discipline). Tagged `article-categories:list`;
 * app/admin/articles/categories/actions.ts calls revalidateTag on every
 * create/rename/delete/reorder.
 *
 * Falls back to the hardcoded constant when the table is unreachable OR
 * returns zero rows (e.g. this migration hasn't been applied yet, or every
 * category has been deleted) — the public filter degrades to the
 * founder-approved default order rather than an unordered/broken one.
 */
export async function getManagedArticleCategories(): Promise<ManagedArticleCategory[]> {
  let supabase;
  try {
    supabase = createPublicContentClient();
  } catch {
    return FALLBACK_CATEGORIES;
  }

  const cached = unstable_cache(
    async () => {
      const { data, error } = await supabase
        .from("article_categories")
        .select(SELECT_COLUMNS)
        .order("sort_order", { ascending: true });
      if (error || !data || data.length === 0) return null;
      return data as ManagedArticleCategory[];
    },
    ["article-categories", "list"],
    { tags: ["article-categories:list"], revalidate: 3600 }
  );

  const rows = await cached();
  return rows ?? FALLBACK_CATEGORIES;
}

/**
 * Managed article categories for the ADMIN article editor's dropdown —
 * takes an already-created authenticated client (the editor page already
 * has one from lib/supabase/server's createClient(); no separate cookie-free
 * client is needed since this route is never statically prerendered). Same
 * fallback-on-unreachable/empty discipline as getManagedArticleCategories
 * above, so the editor's category picker always has usable options even if
 * the table can't be read.
 */
export async function getManagedArticleCategoriesForEditor(
  supabase: SupabaseClient
): Promise<ManagedArticleCategory[]> {
  try {
    const { data, error } = await supabase
      .from("article_categories")
      .select(SELECT_COLUMNS)
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) return FALLBACK_CATEGORIES;
    return data as ManagedArticleCategory[];
  } catch {
    return FALLBACK_CATEGORIES;
  }
}

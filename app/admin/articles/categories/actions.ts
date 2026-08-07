"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { swapSortOrder, validateCategoryName } from "@/lib/articles/categoryAdmin";
import type { ArticleCategoryRow } from "@/lib/supabase/types";

export type CategoryActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export type CategoryQuickCreateResult =
  | { ok: true; id: string; name: string; slug: string; error?: undefined }
  | { ok: false; error: string };

function revalidateCategoryViews() {
  revalidatePath("/admin/articles/categories");
  revalidatePath("/admin/articles");
  // Every article edit page embeds the picker too, but revalidating each by
  // id isn't practical here — the editor re-fetches the managed list on
  // every server render anyway (no client-side cache of it), so a stale
  // picker is at most a fresh-navigation-away, and Save always writes the
  // article's own category value regardless.
  revalidateTag("article-categories:list", { expire: 0 });
}

async function fetchExistingCategories(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Pick<ArticleCategoryRow, "id" | "name" | "slug">[]> {
  const { data } = await supabase.from("article_categories").select("id, name, slug");
  return (data as Pick<ArticleCategoryRow, "id" | "name" | "slug">[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// Create — both the categories admin page's own form and the article
// editor's inline "+ New category" quick-create call this.
// ---------------------------------------------------------------------------

async function createCategory(
  name: string,
  description: string | null
): Promise<CategoryQuickCreateResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create a category." };

  const existing = await fetchExistingCategories(supabase);
  const validated = validateCategoryName(name, existing);
  if (!validated.ok) return validated;

  // New categories sort after every existing one by default — a founder
  // can reorder with the up/down controls afterwards (keeps the create
  // flow simple, per the founder's "keep it simple" ask on sort_order).
  const { data: maxRow } = await supabase
    .from("article_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("article_categories")
    .insert({
      name: validated.name,
      slug: validated.slug,
      description: description?.trim() || null,
      sort_order: nextSortOrder,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: `Could not create the category: ${error?.message ?? "unknown error"}` };
  }

  revalidateCategoryViews();
  return { ok: true, id: data.id as string, name: validated.name, slug: validated.slug };
}

/** Full create form on /admin/articles/categories (name + optional description). */
export async function createArticleCategory(
  _prevState: CategoryActionResult,
  formData: FormData
): Promise<CategoryActionResult> {
  const name = String(formData.get("name") ?? "");
  const description = String(formData.get("description") ?? "");
  const result = await createCategory(name, description);
  if (!result.ok) return result;
  return { ok: true };
}

/**
 * Inline quick-create from the article editor (mirrors
 * app/admin/products/actions.ts's createItemGroupInline) — a founder can
 * add a category without leaving the draft they're working on. Returns the
 * new row's id/name/slug so the editor can select it immediately.
 */
export async function createArticleCategoryInline(name: string): Promise<CategoryQuickCreateResult> {
  return createCategory(name, null);
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export async function renameArticleCategory(
  id: string,
  _prevState: CategoryActionResult,
  formData: FormData
): Promise<CategoryActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to rename a category." };

  const name = String(formData.get("name") ?? "");
  const description = String(formData.get("description") ?? "").trim();

  const existing = await fetchExistingCategories(supabase);
  const validated = validateCategoryName(name, existing, id);
  if (!validated.ok) return validated;

  // Renaming ONLY updates this row (name/slug/description). Every article
  // that currently carries the OLD category string as free text keeps that
  // exact string — this deliberately does NOT cascade to articles.category
  // (see the migration's CRITICAL DESIGN CONSTRAINT note). A founder who
  // wants existing articles to show the new name would need to re-save
  // each article's category individually; that's out of scope here by
  // design, not an oversight.
  const { error } = await supabase
    .from("article_categories")
    .update({ name: validated.name, slug: validated.slug, description: description || null })
    .eq("id", id);

  if (error) return { ok: false, error: `Could not save the category: ${error.message}` };

  revalidateCategoryViews();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delete — hard delete of the article_categories row ONLY. Never touches
// articles.category on any row (see the migration's CRITICAL DESIGN
// CONSTRAINT note) — an article that carried this category string keeps
// displaying it verbatim; it simply stops appearing as a picker option for
// FUTURE saves. The confirm dialog stating the usage count lives in the
// client component (CategoryListItem.tsx), which already has the count
// computed for display.
// ---------------------------------------------------------------------------

export async function deleteArticleCategory(id: string): Promise<CategoryActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to delete a category." };

  const { error } = await supabase.from("article_categories").delete().eq("id", id);
  if (error) return { ok: false, error: `Could not delete the category: ${error.message}` };

  revalidateCategoryViews();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reorder — simple up/down swap with the adjacent row (lib/articles/
// categoryAdmin.ts's swapSortOrder), per the founder's "keep it simple" ask.
// ---------------------------------------------------------------------------

export async function reorderArticleCategory(
  id: string,
  direction: "up" | "down"
): Promise<CategoryActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to reorder categories." };

  const { data, error: loadError } = await supabase
    .from("article_categories")
    .select("id, sort_order")
    .order("sort_order", { ascending: true });
  if (loadError) return { ok: false, error: `Could not load categories: ${loadError.message}` };

  const rows = (data as { id: string; sort_order: number }[] | null) ?? [];
  const swap = swapSortOrder(rows, id, direction);
  if (!swap) return { ok: true }; // already at that end — nothing to do, not an error

  for (const row of swap) {
    const { error } = await supabase
      .from("article_categories")
      .update({ sort_order: row.sort_order })
      .eq("id", row.id);
    if (error) return { ok: false, error: `Could not reorder categories: ${error.message}` };
  }

  revalidateCategoryViews();
  return { ok: true };
}

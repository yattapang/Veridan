"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { validateTaxonomyLabel } from "@/lib/taxonomies/taxonomyAdmin";
import type { ProductCategoryAdminRow } from "@/lib/supabase/types";

export type ProductCategoryActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export type ProductCategoryQuickCreateResult =
  | { ok: true; id: string; name: string; label: string; error?: undefined }
  | { ok: false; error: string };

function revalidateProductCategoryViews() {
  revalidatePath("/admin/products/categories");
  revalidatePath("/admin/products");
  // Same "no per-id revalidation" reasoning as
  // app/admin/companies/types/actions.ts's revalidateCompanyTypeViews —
  // the product form re-fetches the managed list on every server render.
}

async function fetchExistingProductCategories(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Pick<ProductCategoryAdminRow, "id" | "name" | "label">[]> {
  const { data } = await supabase.from("product_categories_admin").select("id, name, label");
  return (data as Pick<ProductCategoryAdminRow, "id" | "name" | "label">[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// Create — both the product categories admin page's own form and the
// product form's inline "+ New category" quick-create call this.
// ---------------------------------------------------------------------------

async function createProductCategory(label: string): Promise<ProductCategoryQuickCreateResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create a product category." };

  const existing = await fetchExistingProductCategories(supabase);
  const validated = validateTaxonomyLabel(label, existing);
  if (!validated.ok) return validated;

  const { data: maxRow } = await supabase
    .from("product_categories_admin")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("product_categories_admin")
    .insert({ name: validated.name, label: validated.label, sort_order: nextSortOrder })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: `Could not create the category: ${error?.message ?? "unknown error"}` };
  }

  revalidateProductCategoryViews();
  return { ok: true, id: data.id as string, name: validated.name, label: validated.label };
}

/** Full create form on /admin/products/categories (label only — the stored name is derived). */
export async function createProductCategoryForm(
  _prevState: ProductCategoryActionResult,
  formData: FormData
): Promise<ProductCategoryActionResult> {
  const label = String(formData.get("label") ?? "");
  const result = await createProductCategory(label);
  if (!result.ok) return result;
  return { ok: true };
}

/**
 * Inline quick-create from the product create/edit form (mirrors
 * app/admin/products/actions.ts's createItemGroupInline) — a founder can
 * add a category without leaving the product they're working on. Returns
 * the new row's id/name/label so the calling form can select it
 * immediately.
 */
export async function createProductCategoryInline(label: string): Promise<ProductCategoryQuickCreateResult> {
  return createProductCategory(label);
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export async function renameProductCategory(
  id: string,
  _prevState: ProductCategoryActionResult,
  formData: FormData
): Promise<ProductCategoryActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to rename a product category." };

  const label = String(formData.get("label") ?? "");

  const existing = await fetchExistingProductCategories(supabase);
  const validated = validateTaxonomyLabel(label, existing, id);
  if (!validated.ok) return validated;

  // Renaming ONLY updates this row (name/label). Every product that
  // currently carries the OLD stored value as its `generic_category` keeps
  // that exact value — this deliberately does NOT cascade to
  // products.generic_category (see the migration's header note).
  const { error } = await supabase
    .from("product_categories_admin")
    .update({ name: validated.name, label: validated.label })
    .eq("id", id);

  if (error) return { ok: false, error: `Could not save the category: ${error.message}` };

  revalidateProductCategoryViews();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delete — hard delete of the product_categories_admin row ONLY. Never
// touches products.generic_category on any row (see the migration's
// header note) — a product that carried this category's stored value
// keeps its value verbatim; it simply stops appearing as a picker option
// for FUTURE saves. The confirm dialog stating the usage count lives in
// the client component (ProductCategoryListItem.tsx), which already has
// the count computed for display.
// ---------------------------------------------------------------------------

export async function deleteProductCategory(id: string): Promise<ProductCategoryActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to delete a product category." };

  const { error } = await supabase.from("product_categories_admin").delete().eq("id", id);
  if (error) return { ok: false, error: `Could not delete the category: ${error.message}` };

  revalidateProductCategoryViews();
  return { ok: true };
}

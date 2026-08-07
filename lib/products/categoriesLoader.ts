import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { FALLBACK_PRODUCT_CATEGORIES } from "./productCategories";
import type { ProductCategoryAdminRow } from "@/lib/supabase/types";

export type ManagedProductCategory = Pick<ProductCategoryAdminRow, "id" | "name" | "label" | "sort_order">;

const SELECT_COLUMNS = "id, name, label, sort_order";

/**
 * Fallback rows derived from lib/products/productCategories.ts, used only
 * when product_categories_admin is unreachable or empty — same
 * DB-with-hardcoded-fallback discipline as lib/articles/categoriesLoader.ts.
 */
const FALLBACK_ROWS: ManagedProductCategory[] = FALLBACK_PRODUCT_CATEGORIES.map((c) => ({
  id: `fallback-${c.name}`,
  name: c.name,
  label: c.label,
  sort_order: c.sort_order,
}));

/**
 * Managed product categories for the admin Products pages (list filter,
 * create/edit form's Category picker) — takes an already-created
 * authenticated client (these pages are never statically prerendered).
 * Falls back to the hardcoded constant when the table is unreachable OR
 * returns zero rows, so the picker always has usable options even if this
 * migration hasn't been applied yet.
 */
export async function getManagedProductCategories(
  supabase: SupabaseClient
): Promise<ManagedProductCategory[]> {
  try {
    const { data, error } = await supabase
      .from("product_categories_admin")
      .select(SELECT_COLUMNS)
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) return FALLBACK_ROWS;
    return data as ManagedProductCategory[];
  } catch {
    return FALLBACK_ROWS;
  }
}

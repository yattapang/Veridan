/**
 * Fallback product category list — founder feedback 2026-08-07: product
 * categories became an ADMIN-MANAGED list (create/rename/delete), backed
 * by the `product_categories_admin` table (supabase/migrations/
 * 20260807000001_managed_taxonomies.sql — NOT the unrelated marketing
 * `product_categories` site_content section). That table is the source of
 * truth for the product form's Category picker; this constant is used
 * ONLY as a fallback when the table is unreachable or empty (see
 * lib/products/categoriesLoader.ts), mirroring lib/articles/categories.ts's
 * relationship to lib/articles/categoriesLoader.ts.
 *
 * Contents match the migration's seed rows verbatim (name / label /
 * sort_order) so the fallback never drifts from what a fresh database
 * actually contains — if you change one, change the other.
 *
 * `products.generic_category` itself is unchanged by this decision: it
 * stays a not-null free-text column (see the migration's header note) —
 * this list (managed or fallback) is presented as SELECTABLE OPTIONS in
 * the product form, plus a legacy/custom value when the product's current
 * category isn't among them (lib/taxonomies/taxonomyAdmin.ts's
 * buildTaxonomyOptions).
 */
export interface ProductCategorySeed {
  name: string;
  label: string;
  sort_order: number;
}

export const FALLBACK_PRODUCT_CATEGORIES: ProductCategorySeed[] = [
  { name: "locksets", label: "Locksets", sort_order: 1 },
  { name: "closers", label: "Closers", sort_order: 2 },
  { name: "hinges", label: "Hinges", sort_order: 3 },
  { name: "exit_devices", label: "Exit devices", sort_order: 4 },
  { name: "access_control", label: "Access control", sort_order: 5 },
  { name: "ironmongery", label: "Ironmongery", sort_order: 6 },
  { name: "signage", label: "Signage", sort_order: 7 },
  { name: "frames", label: "Frames", sort_order: 8 },
  { name: "other", label: "Other", sort_order: 9 },
];

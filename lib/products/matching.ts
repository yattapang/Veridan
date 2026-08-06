/**
 * Pure logic for the /products/[category] static category pages (client
 * review comment: "I thought these were links to show actual products").
 * No Supabase client, no I/O — same discipline as lib/catalogue/grouping.ts
 * and lib/catalogue/validation.ts.
 *
 * Relative imports only (not the "@/..." alias) — vitest here has no
 * path-alias resolution configured for runtime imports (only TS/type-only
 * imports are alias-safe), so a runtime value import through "@/lib/..."
 * fails under `npm test`. See lib/item-groups.ts / lib/catalogue/validation.ts
 * for the same note. This file has no runtime imports at all, so it's
 * importable from both page.tsx (via "@/lib/products/matching") and its
 * test file (via "./matching") without issue.
 */

export interface ProductCategoryKeyed {
  key: string;
  title: string;
}

export interface CatalogueCategoryLike {
  category: string | null;
}

export interface BrandEntryLike {
  name: string;
  logoPath: string | null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Exact-match lookup of a product category by its `key` (the URL segment). */
export function findProductCategoryByKey<T extends { key: string }>(
  categories: readonly T[],
  key: string
): T | undefined {
  return categories.find((c) => c.key === key);
}

/**
 * Whether a free-text catalogue-document `category` value refers to the
 * given product category. The founder types catalogue categories as free
 * text (no shared enum with product_categories), so this matches FORGIVINGLY:
 * case-insensitive and whitespace-trimmed, against EITHER the category's
 * `title` OR its `key` — an exact-string match would silently show nothing
 * for real founder input like " Locksets " or "locksets" matching the
 * "Locksets & Deadbolts" title.
 */
export function catalogueCategoryMatchesProductCategory(
  catalogueCategory: string | null | undefined,
  category: ProductCategoryKeyed
): boolean {
  if (!catalogueCategory) return false;
  const normalized = normalize(catalogueCategory);
  if (!normalized) return false;
  return normalized === normalize(category.title) || normalized === normalize(category.key);
}

/**
 * Narrows a list of public catalogue documents down to the ones whose
 * `category` forgivingly matches the given product category. Callers must
 * pass an already visibility-scoped list (lib/catalogue/publicLoader.ts's
 * getPublicCatalogueDocuments) — this function is never the visibility
 * boundary, only a further narrowing on top of it.
 */
export function filterCatalogueDocumentsForCategory<T extends CatalogueCategoryLike>(
  documents: readonly T[],
  category: ProductCategoryKeyed
): T[] {
  return documents.filter((doc) => catalogueCategoryMatchesProductCategory(doc.category, category));
}

/**
 * Resolves a product category's `brands` (plain name strings, e.g.
 * "Assa Abloy") against the full `brands_supplied` list (BrandEntry[], which
 * may carry an uploaded logo) — case-insensitive, whitespace-tolerant match
 * by name. Preserves the category's own brand order. A brand name with no
 * match in `allBrands` (e.g. the founder renamed/removed it from
 * brands_supplied) still renders — falls back to a text-only entry rather
 * than silently dropping it, since the category's own brands array is the
 * source of truth for "brands supplied in this category".
 */
export function resolveCategoryBrands(
  categoryBrandNames: readonly string[],
  allBrands: readonly BrandEntryLike[]
): BrandEntryLike[] {
  return categoryBrandNames.map((name) => {
    const found = allBrands.find((b) => normalize(b.name) === normalize(name));
    return found ?? { name, logoPath: null };
  });
}

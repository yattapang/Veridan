/**
 * Pure grouping/filtering helpers shared by the admin catalogue list
 * (app/admin/catalogue/) and the public browse surface
 * (app/(marketing)/catalogue/) — Plan §3.4/§3.5: both need "grouped/
 * filterable by brand + category". Generic over any row shape that at least
 * has brand/category, so the same functions work for
 * CatalogueDocumentWithDetails (admin) and the narrower public-loader shape.
 */

export interface CatalogueGroupable {
  brand: string;
  category: string | null;
}

/** Distinct brand names, alphabetically sorted, for a filter bar's option list. */
export function distinctBrands<T extends CatalogueGroupable>(documents: T[]): string[] {
  return Array.from(new Set(documents.map((d) => d.brand).filter((b) => b.trim().length > 0))).sort((a, b) =>
    a.localeCompare(b)
  );
}

/** Distinct category values (nulls excluded), alphabetically sorted. */
export function distinctCategories<T extends CatalogueGroupable>(documents: T[]): string[] {
  return Array.from(
    new Set(documents.map((d) => d.category).filter((c): c is string => Boolean(c && c.trim().length > 0)))
  ).sort((a, b) => a.localeCompare(b));
}

/** Groups documents by brand, preserving first-seen brand order. */
export function groupByBrand<T extends CatalogueGroupable>(documents: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const doc of documents) {
    const bucket = groups.get(doc.brand);
    if (bucket) bucket.push(doc);
    else groups.set(doc.brand, [doc]);
  }
  return groups;
}

/** Groups documents by category; documents with no category fall under the literal label "Uncategorized". */
export function groupByCategory<T extends CatalogueGroupable>(documents: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const doc of documents) {
    const key = doc.category?.trim() || "Uncategorized";
    const bucket = groups.get(key);
    if (bucket) bucket.push(doc);
    else groups.set(key, [doc]);
  }
  return groups;
}

export interface CatalogueFilterParams {
  brand: string;
  category: string;
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Parses the brand/category filter-bar query params, mirroring lib/item-groups.ts's parseProductFilterParams convention. */
export function parseCatalogueFilterParams(
  params: Record<string, string | string[] | undefined>
): CatalogueFilterParams {
  return {
    brand: firstParam(params.brand).trim(),
    category: firstParam(params.category).trim(),
  };
}

export function hasAnyCatalogueFilter(filters: CatalogueFilterParams): boolean {
  return Boolean(filters.brand || filters.category);
}

/**
 * Client-side filter applied on top of an already visibility-scoped list
 * (RLS/query already restricted to what the caller is allowed to see — this
 * function only narrows by brand/category, it is never the visibility
 * boundary). Used by the public browse page's client-side chip filter (kept
 * client-side so the page itself stays statically prerenderable, same
 * pattern as ArticleListClient's category filter) and is equally usable by
 * the admin list.
 */
export function filterCatalogueDocuments<T extends CatalogueGroupable>(
  documents: T[],
  filters: Partial<CatalogueFilterParams>
): T[] {
  return documents.filter((doc) => {
    if (filters.brand && doc.brand !== filters.brand) return false;
    if (filters.category && (doc.category ?? "") !== filters.category) return false;
    return true;
  });
}

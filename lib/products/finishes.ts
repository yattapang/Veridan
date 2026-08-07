/**
 * Pure helper for the Hardware Library product form's finish datalist
 * type-aheads (founder feedback 2026-08-07: "the finish should allow
 * dropdown options that when typed data is entered if it already exists
 * then it is filtered"). Products has three finish-related free-text
 * columns — `specified_finish`, `supplied_finish`, `finish_code` — none of
 * which are CHECK-constrained or backed by a managed table (unlike company
 * types / product categories): a finish is inherently open-ended (any
 * manufacturer's arbitrary finish name/code), so a fixed picker doesn't
 * fit. Instead, app/admin/products/page.tsx loads every existing value for
 * these three columns and this function collapses them to distinct,
 * sorted lists that populate an HTML <datalist> per field — typing filters
 * to existing values (native browser behavior) while still allowing any
 * new value, exactly like a plain text input.
 *
 * Kept dependency-free (no Supabase client) so the dedup/sort logic is
 * unit-testable in isolation.
 */

export interface ProductFinishFields {
  specified_finish: string | null;
  supplied_finish: string | null;
  finish_code: string | null;
}

export interface DistinctFinishValues {
  specifiedFinishes: string[];
  suppliedFinishes: string[];
  finishCodes: string[];
}

function distinctSorted(values: (string | null)[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Collects the distinct, sorted, non-blank values already in use for each
 * of the three finish columns across every product row passed in (callers
 * should query all products, not just a filtered/paginated subset, so the
 * type-ahead reflects the whole Hardware Library).
 */
export function collectDistinctFinishValues(products: ProductFinishFields[]): DistinctFinishValues {
  return {
    specifiedFinishes: distinctSorted(products.map((p) => p.specified_finish)),
    suppliedFinishes: distinctSorted(products.map((p) => p.supplied_finish)),
    finishCodes: distinctSorted(products.map((p) => p.finish_code)),
  };
}

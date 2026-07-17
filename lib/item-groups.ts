import type { GradeValue, ProductWithSupplier } from "./supabase/types";
// Relative import (not the "@/..." alias) — vitest here has no path-alias
// resolution configured for runtime imports (only TS/type-only imports are
// alias-safe, since those get erased before module resolution), so a
// runtime value import through "@/lib/..." fails under `npm test`.
import { GRADE_VALUES } from "./supabase/types";

/**
 * Pure helpers for Phase 2A (item groups / product variants). Kept
 * dependency-free (no Supabase client) so they're unit-testable in
 * isolation, mirroring the lib/hardware-sets.ts / lib/landed-cost/engine.ts
 * pattern — matches Veridan_Phase2_Plan_v1.md §6 Layer 1 (pure-function
 * core logic gets *.test.ts coverage).
 */

export function isGradeValue(value: unknown): value is GradeValue {
  return typeof value === "string" && (GRADE_VALUES as string[]).includes(value);
}

/**
 * Validates a merge selection (Task 30) before any database work happens.
 * Both groups must be chosen and must be different — merging a group into
 * itself is a no-op that would otherwise silently "succeed" while doing
 * nothing useful.
 */
export function validateMergeSelection(
  survivingGroupId: string,
  losingGroupId: string
): { ok: true } | { ok: false; error: string } {
  if (!survivingGroupId || !losingGroupId) {
    return { ok: false, error: "Choose both a surviving group and a group to merge in." };
  }
  if (survivingGroupId === losingGroupId) {
    return { ok: false, error: "Choose two different item groups to merge." };
  }
  return { ok: true };
}

/** Counts products currently pointing at a given item_group_id. */
export function countProductsInGroup(
  products: { item_group_id: string | null }[],
  groupId: string
): number {
  return products.filter((p) => p.item_group_id === groupId).length;
}

/**
 * Every product sharing an item_group_id ("same physical item, N
 * suppliers/finishes") — the direct answer to Phase2 plan §1.5's
 * comparison view. `excludeProductId` lets a product's own detail row
 * exclude itself when computing "N other suppliers/finishes offer this
 * item" (Task 32).
 */
export function siblingsInGroup(
  products: ProductWithSupplier[],
  itemGroupId: string,
  excludeProductId?: string
): ProductWithSupplier[] {
  return products.filter((p) => p.item_group_id === itemGroupId && p.id !== excludeProductId);
}

/**
 * Groups a set of same-item-group products by finish_code for the
 * comparison view table (§1.5: "grouped by finish_code, showing supplier
 * name, unit_cost, cost_currency, and last-updated date"). Products with no
 * finish_code fall under the literal label "—" rather than being dropped.
 */
export function groupByFinish(products: ProductWithSupplier[]): Map<string, ProductWithSupplier[]> {
  const groups = new Map<string, ProductWithSupplier[]>();
  for (const product of products) {
    const key = product.finish_code?.trim() || "—";
    const bucket = groups.get(key);
    if (bucket) bucket.push(product);
    else groups.set(key, [product]);
  }
  return groups;
}

/**
 * Task 32's inline picker affordance copy: "N other suppliers/finishes
 * offer this item." Returns null when there's nothing to say (no siblings),
 * so callers can conditionally render without duplicating the count check.
 */
export function siblingAffordanceText(siblingCount: number): string | null {
  if (siblingCount <= 0) return null;
  const noun = siblingCount === 1 ? "other supplier/finish offers" : "other suppliers/finishes offer";
  return `${siblingCount} ${noun} this item`;
}

/** Normalized filter state for the /admin/products filter bar (Task 31) and the picker filter bars (Task 32). */
export interface ProductFilterParams {
  q: string;
  category: string;
  manufacturer: string;
  supplierId: string;
  itemGroupId: string;
  grade: string;
  finishCode: string;
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Parses the combinable filter set (family/item_group, grade, finish_code,
 * supplier, manufacturer, generic_category) from a Next.js searchParams
 * object into a normalized, trimmed shape — the same convention as the
 * existing products search (URL query-param state, §1.5). Pulled out as a
 * pure function so the parsing rules (trim, array-takes-first, blank means
 * "no filter") are unit-testable without a request object.
 */
export function parseProductFilterParams(
  params: Record<string, string | string[] | undefined>
): ProductFilterParams {
  return {
    q: firstParam(params.q).trim(),
    category: firstParam(params.category).trim(),
    manufacturer: firstParam(params.manufacturer).trim(),
    supplierId: firstParam(params.supplier_id).trim(),
    itemGroupId: firstParam(params.item_group_id).trim(),
    grade: firstParam(params.grade).trim(),
    finishCode: firstParam(params.finish_code).trim(),
  };
}

export function hasAnyFilter(filters: ProductFilterParams): boolean {
  return Boolean(
    filters.q ||
      filters.category ||
      filters.manufacturer ||
      filters.supplierId ||
      filters.itemGroupId ||
      filters.grade ||
      filters.finishCode
  );
}

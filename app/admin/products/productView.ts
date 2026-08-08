/**
 * The Hardware Library's server→client DTOs (security review 2026-08-08,
 * BLOCKER-1).
 *
 * `ProductListItem` is a Client Component, so whatever it is given is serialised
 * into the RSC flight payload and lands in the HTML a staff member can read with
 * Ctrl-U. It used to be handed the whole `products` row (`unit_cost`,
 * `cost_currency`) plus the entire `suppliers` table, with a `showCosts={false}`
 * flag that only suppressed the RENDER. This module is the fix: the server maps
 * each row to `ProductListItemView`, which HAS no cost field and cannot be given
 * one (it extends `NoCostFields`, and its keys are camelCase so a raw snake_case
 * row is not assignable either).
 *
 * The founder view is not a boolean any more — it is the OPTIONAL `costs`
 * object. Presence of that object IS the permission, so there is no way to
 * render the cost UI without having deliberately passed the cost data, and no
 * way to pass the cost data without meaning to.
 */

import type { NoCostFields } from "@/lib/roles/costFree";
import type {
  ItemGroupRow,
  ProductWithSupplier,
  SupplierRow,
} from "@/lib/supabase/types";
import type { ManagedProductCategory } from "@/lib/products/categoriesLoader";
import type { DistinctFinishValues } from "@/lib/products/finishes";

/** Task 40 — read-only provenance for a product's most recent scanned price update. */
export interface ProductPriceProvenance {
  effectiveDate: string;
  fileName: string;
  fileUrl: string | null;
}

/**
 * What EVERY role may see about a product. No supplier cost, no cost currency,
 * and no supplier identity — `public.suppliers` is founder-only at the database
 * from 20260807000004_user_roles.sql §6b, so `supplierName` is simply null for a
 * staff viewer rather than being withheld by convention.
 */
export interface ProductListItemView extends NoCostFields {
  id: string;
  description: string;
  active: boolean;
  genericCategory: string;
  manufacturer: string | null;
  productRef: string | null;
  catalogueRef: string | null;
  unit: string;
  supplierName: string | null;
  itemGroupId: string | null;
  itemGroupLabel: string | null;
  finishCode: string | null;
  designSeries: string | null;
}

/**
 * The founder-only half. Everything here is either a cost figure or an input to
 * the cost-entry form (`ProductForm` edits `unit_cost`), so the whole object is
 * withheld from a staff viewer — including `suppliers`, which is a founder-only
 * table, and `priceProvenance`, which names the supplier price list a cost came
 * from.
 */
export interface ProductListItemCosts {
  /** The full row, for the inline edit form. Founder-only by construction. */
  row: ProductWithSupplier;
  unitCost: number;
  costCurrency: string;
  suppliers: SupplierRow[];
  itemGroups: ItemGroupRow[];
  productCategories: ManagedProductCategory[];
  distinctFinishes: DistinctFinishValues;
  priceProvenance: ProductPriceProvenance | null;
}

/**
 * The columns a staff-scoped `products` query selects. Deliberately spelled out
 * rather than `select("*")`: the cost columns are never fetched in the first
 * place, so there is nothing on the server to accidentally forward.
 */
export const STAFF_PRODUCT_COLUMNS =
  "id, description, generic_category, manufacturer, product_ref, catalogue_ref, unit, active, item_group_id, finish_code, design_series, item_groups(id, family_name, grade)";

/** The shape `STAFF_PRODUCT_COLUMNS` returns — a strict subset of ProductWithSupplier. */
export interface ProductListSourceRow {
  id: string;
  description: string;
  generic_category: string;
  manufacturer: string | null;
  product_ref: string | null;
  catalogue_ref: string | null;
  unit: string;
  active: boolean;
  item_group_id: string | null;
  finish_code: string | null;
  design_series: string | null;
  item_groups?: { id: string; family_name: string; grade: string | null } | null;
  suppliers?: { id: string; name: string } | null;
}

/**
 * Row → cost-free view. The one place a product becomes client-safe; every
 * caller goes through it, and it physically cannot copy a cost across because
 * `ProductListItemView` has no field to copy it into.
 */
export function toProductListItemView(row: ProductListSourceRow): ProductListItemView {
  const group = row.item_groups ?? null;
  return {
    id: row.id,
    description: row.description,
    active: row.active,
    genericCategory: row.generic_category,
    manufacturer: row.manufacturer,
    productRef: row.product_ref,
    catalogueRef: row.catalogue_ref,
    unit: row.unit,
    supplierName: row.suppliers?.name ?? null,
    itemGroupId: row.item_group_id,
    itemGroupLabel: group
      ? `${group.family_name}${group.grade ? ` (${group.grade})` : ""}`
      : null,
    finishCode: row.finish_code,
    designSeries: row.design_series,
  };
}

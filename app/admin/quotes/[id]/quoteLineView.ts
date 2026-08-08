/**
 * The quote builder's server→client DTOs (security review 2026-08-08,
 * BLOCKER-1).
 *
 * `QuoteLineRow` is a Client Component. It used to receive the whole
 * `quote_line_items` row — `unit_cost`, `cost_currency`, `unit_cost_usd`,
 * `line_value_usd`, `landed_cost_usd`, `margin_pct_override` — plus the entire
 * `suppliers` table, for every line of every quote a staff member opened. The
 * page even took care to null the separate `landedCostUsd` prop for staff, while
 * the identical figure rode along inside `line`. All of it was serialised into
 * the RSC flight payload regardless of what the component rendered.
 *
 * So the line is now mapped to `QuoteLineRowView`, which carries only what a
 * staff member is allowed to see (label, supplier-free identity, qty, and the
 * CLIENT prices — what the customer is charged is staff work), and extends
 * `NoCostFields` so no cost column can be added to it later without failing
 * `tsc`. Every cost figure lives in the optional `costs` object, whose presence
 * IS the founder permission.
 */

import type { NoCostFields } from "@/lib/roles/costFree";
import type {
  CurrencyCode,
  QuoteLineItemWithDetails,
  SupplierRow,
} from "@/lib/supabase/types";

/** What every role may see about one quote line. */
export interface QuoteLineRowView extends NoCostFields {
  id: string;
  /** Product description, or the ad-hoc line's own text. */
  label: string;
  /** True when there is no linked library product (ad-hoc line). */
  isAdHoc: boolean;
  /**
   * Null either because the line genuinely has no supplier, OR because the
   * viewer is staff and `public.suppliers` is founder-only — `supplierVisible`
   * tells the two apart so the UI never renders a permissions withholding as
   * if it were missing data.
   */
  supplierName: string | null;
  /**
   * False for a staff viewer (the name was WITHHELD, not absent) — see
   * QuoteLineRow.tsx. True for a founder, where `supplierName === null` means
   * the line genuinely has no supplier set.
   */
  supplierVisible: boolean;
  qty: number;
  clientPriceUsd: number | null;
  clientPriceJmd: number | null;
}

/**
 * The founder-only half: the landed cost cell, and every field the inline
 * editor writes (it edits unit cost and cost currency, so the editor as a whole
 * is cost entry). `updateQuoteLine` / `deleteQuoteLine` re-check the role
 * server-side regardless.
 */
export interface QuoteLineRowCosts {
  landedCostUsd: number | null;
  unitCost: number;
  costCurrency: CurrencyCode;
  supplierId: string | null;
  descriptionOverride: string | null;
  suppliers: SupplierRow[];
}

/** Row + computed client prices → cost-free view. */
export function toQuoteLineRowView(
  line: QuoteLineItemWithDetails,
  clientPriceUsd: number | null,
  clientPriceJmd: number | null,
  options: { includeSupplierName: boolean }
): QuoteLineRowView {
  return {
    id: line.id,
    label: line.products?.description ?? line.description_override ?? "Line item",
    isAdHoc: !line.product_id,
    supplierName: options.includeSupplierName ? line.suppliers?.name ?? null : null,
    supplierVisible: options.includeSupplierName,
    qty: Number(line.qty),
    clientPriceUsd,
    clientPriceJmd,
  };
}

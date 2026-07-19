/**
 * Shared display helpers for order/actual-cost UI (Task 53). Pure formatting
 * only — mirrors lib/invoices/format.ts's role for invoices.
 */

import type { ActualCostCategory, OrderStatus } from "@/lib/supabase/types";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  confirmed: "Confirmed",
  in_procurement: "In procurement",
  shipped: "Shipped",
  customs_cleared: "Customs cleared",
  delivered: "Delivered",
  closed: "Closed",
};

/** Tailwind classes for a status badge (matches the admin palette used by QUOTE_STATUS_BADGE / INVOICE_STATUS_BADGE). */
export const ORDER_STATUS_BADGE: Record<OrderStatus, string> = {
  confirmed: "bg-veridan-warm-gray-pale text-veridan-ink",
  in_procurement: "bg-blue-50 text-blue-700",
  shipped: "bg-blue-50 text-blue-700",
  customs_cleared: "bg-amber-50 text-amber-700",
  delivered: "bg-green-50 text-green-700",
  closed: "bg-veridan-warm-gray-pale text-veridan-warm-gray",
};

export const ACTUAL_COST_CATEGORY_LABELS: Record<ActualCostCategory, string> = {
  hardware: "Hardware",
  freight: "Freight",
  insurance: "Insurance",
  brokerage: "Brokerage",
  port_handling: "Port handling",
  duty: "Duty",
  delivery: "Delivery",
  other: "Other",
};

/**
 * Converts a JMD amount to USD (or vice versa) at a quote's locked
 * fx_snapshot.effective_rate (JMD per 1 USD — same direction as
 * lib/invoices/amounts.ts's usdFromJmd) for COMPARISON DISPLAY ONLY. Never
 * write this value back to the database — actual_costs rows keep whichever
 * currency they were entered in, verbatim.
 */
export function convertAtQuoteRate(
  amount: number,
  direction: "usdToJmd" | "jmdToUsd",
  effectiveRate: number,
): number | null {
  if (!Number.isFinite(effectiveRate) || effectiveRate <= 0) return null;
  if (!Number.isFinite(amount)) return null;
  const value = direction === "usdToJmd" ? amount * effectiveRate : amount / effectiveRate;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface ActualCostAmounts {
  amountUsd: number | null;
  amountJmd: number | null;
}

/**
 * Given a row's own currency amounts and the order's quote-locked
 * effective_rate, returns a single "display total" pair where whichever
 * currency the row is MISSING is filled in via convertAtQuoteRate — so a
 * running total across mixed-currency rows can be summed in either currency
 * without silently dropping rows entered in the other one. Callers must
 * label the converted half as an estimate (the row itself still only ever
 * stores what was actually entered).
 */
export function displayAmountsAtQuoteRate(
  row: { amount_usd: number | null; amount_jmd: number | null },
  effectiveRate: number,
): ActualCostAmounts {
  if (row.amount_usd != null && row.amount_jmd != null) {
    return { amountUsd: row.amount_usd, amountJmd: row.amount_jmd };
  }
  if (row.amount_usd != null) {
    return { amountUsd: row.amount_usd, amountJmd: convertAtQuoteRate(row.amount_usd, "usdToJmd", effectiveRate) };
  }
  if (row.amount_jmd != null) {
    return { amountUsd: convertAtQuoteRate(row.amount_jmd, "jmdToUsd", effectiveRate), amountJmd: row.amount_jmd };
  }
  return { amountUsd: null, amountJmd: null };
}

/**
 * Sums a list of actual-cost rows into per-category and overall totals, in
 * both currencies, using displayAmountsAtQuoteRate for any row missing one
 * side. Used by the order detail page's "running totals" panel.
 */
export interface ActualCostTotals {
  byCategory: Record<ActualCostCategory, ActualCostAmounts>;
  overall: ActualCostAmounts;
}

function addAmounts(a: ActualCostAmounts, b: ActualCostAmounts): ActualCostAmounts {
  return {
    amountUsd: a.amountUsd == null && b.amountUsd == null ? null : (a.amountUsd ?? 0) + (b.amountUsd ?? 0),
    amountJmd: a.amountJmd == null && b.amountJmd == null ? null : (a.amountJmd ?? 0) + (b.amountJmd ?? 0),
  };
}

export function computeActualCostTotals(
  rows: { category: ActualCostCategory; amount_usd: number | null; amount_jmd: number | null }[],
  effectiveRate: number,
): ActualCostTotals {
  const byCategory = {} as Record<ActualCostCategory, ActualCostAmounts>;
  let overall: ActualCostAmounts = { amountUsd: null, amountJmd: null };

  for (const row of rows) {
    const amounts = displayAmountsAtQuoteRate(row, effectiveRate);
    byCategory[row.category] = addAmounts(byCategory[row.category] ?? { amountUsd: null, amountJmd: null }, amounts);
    overall = addAmounts(overall, amounts);
  }

  return { byCategory, overall };
}

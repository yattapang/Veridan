/**
 * P&L computation — PURE, no Supabase client, no I/O (Task 54).
 *
 * CRITICAL DATA-SOURCE RULE (PRD §9.2, Phase2_Plan §4/§6 Layer 2 checklist):
 * revenue in this module comes ONLY from `invoice_payments` rows (real cash
 * actually received — cash basis, labeled honestly in the UI) and cost comes
 * ONLY from `actual_costs` rows (real money actually spent). Nothing here
 * reads `quotes.total_client_*` or `quote_line_items` as an input to any sum
 * — a quote's `quote_ref` may be carried through purely as a display label
 * (see `PnlOrderRow.quoteRef`), never as a number fed into a total. This is
 * the exact distinction PRD §9.2 draws against the old, wrong "quote
 * projections" report and the thing the Layer 2 reviewer is asked to verify.
 *
 * Costs are entered in whichever currency the bill actually arrived in
 * (`actual_costs.amount_usd` / `amount_jmd`, at least one required per the
 * DB check constraint). For a JMD total, a USD-only cost is converted at the
 * COST'S OWN ORDER's quote-locked `fx_snapshot.effective_rate` — the same
 * "display conversion only, clearly labeled" rule lib/orders/format.ts's
 * convertAtQuoteRate documents. A JMD-present row always uses its own JMD
 * value directly (never re-derived from a USD sibling value on the same
 * row, to avoid double counting a single expense recorded in both fields).
 */

import { convertAtQuoteRate } from "../orders/format";
import { monthKeyFromDateOnly, monthKeysInRange, isWithinReportRange, type ReportDateRange } from "./period";
import type { ActualCostCategory } from "@/lib/supabase/types";

export interface PnlPaymentInput {
  amountJmd: number;
  /** `date`-typed, e.g. invoice_payments.paid_at. */
  paidAtIso: string;
  /** The order this payment's invoice's quote is fulfilled by, if an order has been created yet. */
  orderId: string | null;
  quoteRef: string;
  invoiceNumber: string;
}

export interface PnlCostInput {
  orderId: string;
  amountUsd: number | null;
  amountJmd: number | null;
  /** `date`-typed, actual_costs.incurred_date. */
  incurredDateIso: string;
  category: ActualCostCategory;
}

/** JMD-per-USD locked rate for each order's quote (`fx_snapshot.effective_rate`), keyed by order id. */
export type OrderRateLookup = Record<string, number>;

/** Resolves a single cost row to a JMD amount: JMD-present rows use their own value; USD-only rows convert at the order's locked rate (null if no rate is known for that order). */
export function costAmountJmd(cost: PnlCostInput, rateByOrderId: OrderRateLookup): number | null {
  if (cost.amountJmd != null) return cost.amountJmd;
  if (cost.amountUsd != null) {
    const rate = rateByOrderId[cost.orderId];
    if (rate == null) return null;
    return convertAtQuoteRate(cost.amountUsd, "usdToJmd", rate);
  }
  return null;
}

/** Adds `amount` to `map[category]`, creating the entry on first touch — categories with no cost never appear (not zero-filled), so the UI can iterate `Object.keys` to show only categories that actually have data. */
function addToCategoryMap(
  map: Partial<Record<ActualCostCategory, number>>,
  category: ActualCostCategory,
  amount: number,
): void {
  map[category] = (map[category] ?? 0) + amount;
}

/**
 * Merges category subtotals across multiple rows (e.g. every month, or every
 * order) into one portfolio-level total per category — the source for a
 * "cost by category" summary section. Only categories present in at least
 * one input row appear in the result.
 */
export function mergeCategoryTotals(
  rows: { byCategory: Partial<Record<ActualCostCategory, number>> }[],
): Partial<Record<ActualCostCategory, number>> {
  const totals: Partial<Record<ActualCostCategory, number>> = {};
  for (const row of rows) {
    for (const [category, amount] of Object.entries(row.byCategory) as [ActualCostCategory, number][]) {
      addToCategoryMap(totals, category, amount);
    }
  }
  return totals;
}

export interface PnlMonthRow {
  monthKey: string;
  revenueJmd: number;
  costJmd: number;
  /** Sum of any cost row that could not be converted to JMD (USD-only, no known order rate) — surfaced so the UI can flag an incomplete total rather than silently under-reporting cost. */
  unconvertedCostUsd: number;
  /** JMD cost subtotal per category — sums to `costJmd`. Only categories with at least one converted cost row appear (not zero-filled). */
  byCategory: Partial<Record<ActualCostCategory, number>>;
  /** USD subtotal per category for cost rows that could not be converted (mirrors `unconvertedCostUsd`, broken out by category so an incomplete category total is surfaced rather than silently absorbed into "other"). */
  unconvertedUsdByCategory: Partial<Record<ActualCostCategory, number>>;
  grossProfitJmd: number;
  marginPct: number | null;
}

/**
 * Monthly P&L across every month in `range` (zero-filled — a month with no
 * activity still appears with all-zero figures, so a founder scanning the
 * table sees a complete YTD picture rather than a gap that could be mistaken
 * for missing data).
 */
export function computePnlByMonth(
  payments: PnlPaymentInput[],
  costs: PnlCostInput[],
  rateByOrderId: OrderRateLookup,
  range: ReportDateRange,
): PnlMonthRow[] {
  const revenueByMonth = new Map<string, number>();
  for (const p of payments) {
    if (!isWithinReportRange(p.paidAtIso, range)) continue;
    const key = monthKeyFromDateOnly(p.paidAtIso);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + p.amountJmd);
  }

  const costByMonth = new Map<string, number>();
  const unconvertedByMonth = new Map<string, number>();
  const categoryByMonth = new Map<string, Partial<Record<ActualCostCategory, number>>>();
  const unconvertedCategoryByMonth = new Map<string, Partial<Record<ActualCostCategory, number>>>();
  for (const c of costs) {
    if (!isWithinReportRange(c.incurredDateIso, range)) continue;
    const key = monthKeyFromDateOnly(c.incurredDateIso);
    const jmd = costAmountJmd(c, rateByOrderId);
    if (jmd == null) {
      unconvertedByMonth.set(key, (unconvertedByMonth.get(key) ?? 0) + (c.amountUsd ?? 0));
      const catMap = unconvertedCategoryByMonth.get(key) ?? {};
      addToCategoryMap(catMap, c.category, c.amountUsd ?? 0);
      unconvertedCategoryByMonth.set(key, catMap);
      continue;
    }
    costByMonth.set(key, (costByMonth.get(key) ?? 0) + jmd);
    const catMap = categoryByMonth.get(key) ?? {};
    addToCategoryMap(catMap, c.category, jmd);
    categoryByMonth.set(key, catMap);
  }

  return monthKeysInRange(range).map((monthKey) => {
    const revenueJmd = revenueByMonth.get(monthKey) ?? 0;
    const costJmd = costByMonth.get(monthKey) ?? 0;
    const grossProfitJmd = revenueJmd - costJmd;
    return {
      monthKey,
      revenueJmd,
      costJmd,
      unconvertedCostUsd: unconvertedByMonth.get(monthKey) ?? 0,
      byCategory: categoryByMonth.get(monthKey) ?? {},
      unconvertedUsdByCategory: unconvertedCategoryByMonth.get(monthKey) ?? {},
      grossProfitJmd,
      marginPct: revenueJmd > 0 ? (grossProfitJmd / revenueJmd) * 100 : null,
    };
  });
}

export interface PnlOrderRow {
  orderId: string;
  /** Display label only — never an input to any sum, see this module's header. */
  quoteRef: string;
  revenueJmd: number;
  costJmd: number;
  unconvertedCostUsd: number;
  /** JMD cost subtotal per category — sums to `costJmd`. Only categories with at least one converted cost row appear (not zero-filled). */
  byCategory: Partial<Record<ActualCostCategory, number>>;
  /** USD subtotal per category for cost rows that could not be converted (mirrors `unconvertedCostUsd`, broken out by category). */
  unconvertedUsdByCategory: Partial<Record<ActualCostCategory, number>>;
  grossProfitJmd: number;
  marginPct: number | null;
}

/**
 * Per-order P&L within `range`. Payments whose `orderId` is null (no order
 * has been created yet for that quote) are excluded from this table — they
 * still count toward `computePnlByMonth`'s totals, since that view is
 * period-scoped rather than order-scoped, but there is no order row to
 * attribute them to here.
 */
export function computePnlByOrder(
  payments: PnlPaymentInput[],
  costs: PnlCostInput[],
  rateByOrderId: OrderRateLookup,
  range: ReportDateRange,
): PnlOrderRow[] {
  const rowByOrder = new Map<string, PnlOrderRow>();

  function ensureRow(orderId: string, quoteRef: string): PnlOrderRow {
    let row = rowByOrder.get(orderId);
    if (!row) {
      row = {
        orderId,
        quoteRef,
        revenueJmd: 0,
        costJmd: 0,
        unconvertedCostUsd: 0,
        byCategory: {},
        unconvertedUsdByCategory: {},
        grossProfitJmd: 0,
        marginPct: null,
      };
      rowByOrder.set(orderId, row);
    }
    return row;
  }

  for (const p of payments) {
    if (!p.orderId) continue;
    if (!isWithinReportRange(p.paidAtIso, range)) continue;
    const row = ensureRow(p.orderId, p.quoteRef);
    row.revenueJmd += p.amountJmd;
  }

  for (const c of costs) {
    if (!isWithinReportRange(c.incurredDateIso, range)) continue;
    // A cost can exist for an order with no payments yet in range — ensureRow
    // needs a quoteRef, which the cost input doesn't carry, so costs for an
    // order with no matching payment row are skipped here (a founder viewing
    // "revenue vs cost per order" before any cash has come in should look at
    // the order detail page's actuals panel instead, which has no such gap).
    const row = rowByOrder.get(c.orderId);
    if (!row) continue;
    const jmd = costAmountJmd(c, rateByOrderId);
    if (jmd == null) {
      row.unconvertedCostUsd += c.amountUsd ?? 0;
      addToCategoryMap(row.unconvertedUsdByCategory, c.category, c.amountUsd ?? 0);
      continue;
    }
    row.costJmd += jmd;
    addToCategoryMap(row.byCategory, c.category, jmd);
  }

  for (const row of rowByOrder.values()) {
    row.grossProfitJmd = row.revenueJmd - row.costJmd;
    row.marginPct = row.revenueJmd > 0 ? (row.grossProfitJmd / row.revenueJmd) * 100 : null;
  }

  return Array.from(rowByOrder.values()).sort((a, b) => b.revenueJmd - a.revenueJmd);
}

/**
 * Cash-flow statement — PURE, no Supabase client, no I/O.
 *
 * Originally (Task 54) this module reported cash IN only, which made it a
 * receipts listing rather than a cash-flow statement. The 2026-08-07
 * financial-statements restructure adds the other half: real cash OUT.
 *
 *     Cash in    customer payments            (invoice_payments)
 *     Cash out   supplier / direct costs paid (actual_costs, paid_date set)
 *                operating expenses paid      (expenses, paid_date set)
 *     = Net cash movement, by month, with a running balance for the period.
 *
 * Same data-source rule as lib/reports/pnl.ts (PRD §9.2): every figure is a
 * real recorded row. `invoiceNumber` / `quoteRef` are reference labels only,
 * never summed.
 *
 * THIS STATEMENT IS ALWAYS CASH BASIS — THERE IS NO TOGGLE HERE, BY
 * DEFINITION. A cash-flow statement on an accrual basis is not a thing. That
 * is precisely why outflow rows come only from `actual_costs` /`expenses`
 * rows that carry a `paid_date`: a row with a NULL paid_date has not been
 * recorded as paid, so no money has left the account and it cannot appear.
 * Unpaid bills are visible on the accrual income statement and in the
 * transaction ledger instead.
 *
 * OPENING/CLOSING BALANCES ARE PERIOD-RELATIVE, NOT BANK BALANCES. The
 * running balance opens at zero at the start of the selected range and
 * accumulates net movement month by month. Veridan does not hold a recorded
 * bank opening balance anywhere in this system, and inventing one would
 * produce a "closing balance" a founder could mistake for their actual
 * account. So the column is labelled as cumulative movement within the
 * period, and `closingBalanceJmd` on the final month equals the period's net
 * movement — which is a true statement about the data that exists.
 */

import type { InvoiceType } from "@/lib/supabase/types";
import { monthKeyFromDateOnly, monthKeysInRange, isWithinReportRange, type ReportDateRange } from "./period";

export interface CashInEntry {
  amountJmd: number;
  /** `date`-typed, invoice_payments.paid_at. */
  paidAtIso: string;
  invoiceNumber: string;
  /** Includes 'standalone' (20260807000003_standalone_invoices.sql) — a payment against an ad-hoc invoice is real cash in, same as any other. */
  invoiceType: InvoiceType;
  quoteRef: string;
  method: string | null;
  reference: string | null;
}

/** What kind of outflow a row is — the two are shown as separate subtotals because one is order-attributable and the other deliberately is not. */
export type CashOutKind = "cost_of_sales" | "operating_expense";

export const CASH_OUT_KIND_LABELS: Record<CashOutKind, string> = {
  cost_of_sales: "Cost of sales paid",
  operating_expense: "Operating expenses paid",
};

export interface CashOutEntry {
  /**
   * Already resolved to JMD by the caller: an order-linked cost uses its
   * order's quote-locked rate, an expense uses the current parameter rate
   * (see lib/expenses/expense.ts). A row that could not be resolved is not
   * passed in at all — it is reported separately as an unconverted amount,
   * never silently counted as zero.
   */
  amountJmd: number;
  /** `date`-typed: actual_costs.paid_date or expenses.paid_date. Never null — an unpaid row is not a cash movement. */
  paidAtIso: string;
  kind: CashOutKind;
  /** Display label of the cost/expense category. */
  categoryLabel: string;
  description: string | null;
  /** Supplier (cost of sales) or vendor (operating expense). */
  party: string | null;
  reference: string | null;
}

export interface CashFlowMonthRow {
  monthKey: string;
  totalInJmd: number;
  /** Positive number — the amount that LEFT the account. */
  totalOutJmd: number;
  /** totalInJmd − totalOutJmd. Negative in a month that spent more than it received. */
  netJmd: number;
  /** Cumulative net movement since the start of the range, BEFORE this month. */
  openingBalanceJmd: number;
  /** openingBalanceJmd + netJmd. */
  closingBalanceJmd: number;
  entries: CashInEntry[];
  outEntries: CashOutEntry[];
}

/**
 * Monthly cash-flow rollup across every month in `range` (zero-filled, so a
 * founder scanning YTD sees every month rather than a gap that reads as
 * missing data). Entries within a month are sorted oldest-first for a
 * natural running-ledger read.
 *
 * `outEntries` defaults to empty so the inflow-only call shape from before
 * the restructure still compiles and still means exactly what it meant.
 */
export function computeCashFlowByMonth(
  entries: CashInEntry[],
  range: ReportDateRange,
  outEntries: CashOutEntry[] = [],
): CashFlowMonthRow[] {
  const inByMonth = new Map<string, CashInEntry[]>();
  for (const e of entries) {
    if (!isWithinReportRange(e.paidAtIso, range)) continue;
    const key = monthKeyFromDateOnly(e.paidAtIso);
    const bucket = inByMonth.get(key) ?? [];
    bucket.push(e);
    inByMonth.set(key, bucket);
  }

  const outByMonth = new Map<string, CashOutEntry[]>();
  for (const e of outEntries) {
    if (!isWithinReportRange(e.paidAtIso, range)) continue;
    const key = monthKeyFromDateOnly(e.paidAtIso);
    const bucket = outByMonth.get(key) ?? [];
    bucket.push(e);
    outByMonth.set(key, bucket);
  }

  let running = 0;
  return monthKeysInRange(range).map((monthKey) => {
    const monthIn = (inByMonth.get(monthKey) ?? []).slice().sort((a, b) => a.paidAtIso.localeCompare(b.paidAtIso));
    const monthOut = (outByMonth.get(monthKey) ?? []).slice().sort((a, b) => a.paidAtIso.localeCompare(b.paidAtIso));
    const totalInJmd = monthIn.reduce((sum, e) => sum + e.amountJmd, 0);
    const totalOutJmd = monthOut.reduce((sum, e) => sum + e.amountJmd, 0);
    const netJmd = totalInJmd - totalOutJmd;
    const openingBalanceJmd = running;
    running += netJmd;
    return {
      monthKey,
      totalInJmd,
      totalOutJmd,
      netJmd,
      openingBalanceJmd,
      closingBalanceJmd: running,
      entries: monthIn,
      outEntries: monthOut,
    };
  });
}

/** Grand total cash in across `range` — exposed separately so the report header doesn't have to re-reduce the monthly rows. */
export function totalCashInJmd(rows: CashFlowMonthRow[]): number {
  return rows.reduce((sum, r) => sum + r.totalInJmd, 0);
}

/** Grand total cash out across `range`, as a positive number. */
export function totalCashOutJmd(rows: CashFlowMonthRow[]): number {
  return rows.reduce((sum, r) => sum + r.totalOutJmd, 0);
}

/** Net cash movement across `range` — equals the final month's `closingBalanceJmd`. */
export function netCashMovementJmd(rows: CashFlowMonthRow[]): number {
  return totalCashInJmd(rows) - totalCashOutJmd(rows);
}

/** Outflow subtotal for one kind across the whole period, for the statement's summary block. */
export function totalCashOutByKind(rows: CashFlowMonthRow[], kind: CashOutKind): number {
  return rows.reduce(
    (sum, r) => sum + r.outEntries.reduce((s, e) => s + (e.kind === kind ? e.amountJmd : 0), 0),
    0,
  );
}

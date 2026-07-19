/**
 * Cash-flow computation — PURE, no Supabase client, no I/O (Task 54).
 *
 * Same data-source rule as lib/reports/pnl.ts: cash in is derived entirely
 * from `invoice_payments` rows (real money received). `invoiceNumber` and
 * `quoteRef` are carried through purely as reference labels for the UI —
 * never summed or used as a total input.
 */

import { monthKeyFromDateOnly, monthKeysInRange, isWithinReportRange, type ReportDateRange } from "./period";

export interface CashInEntry {
  amountJmd: number;
  /** `date`-typed, invoice_payments.paid_at. */
  paidAtIso: string;
  invoiceNumber: string;
  invoiceType: "deposit" | "balance";
  quoteRef: string;
  method: string | null;
  reference: string | null;
}

export interface CashFlowMonthRow {
  monthKey: string;
  totalInJmd: number;
  entries: CashInEntry[];
}

/**
 * Monthly cash-in rollup across every month in `range` (zero-filled, same
 * rationale as computePnlByMonth — a founder scanning YTD cash flow should
 * see every month, not just the ones with activity). Entries within a month
 * are sorted oldest-first for a natural running-ledger read.
 */
export function computeCashFlowByMonth(entries: CashInEntry[], range: ReportDateRange): CashFlowMonthRow[] {
  const byMonth = new Map<string, CashInEntry[]>();
  for (const e of entries) {
    if (!isWithinReportRange(e.paidAtIso, range)) continue;
    const key = monthKeyFromDateOnly(e.paidAtIso);
    const bucket = byMonth.get(key) ?? [];
    bucket.push(e);
    byMonth.set(key, bucket);
  }

  return monthKeysInRange(range).map((monthKey) => {
    const monthEntries = (byMonth.get(monthKey) ?? []).slice().sort((a, b) => a.paidAtIso.localeCompare(b.paidAtIso));
    return {
      monthKey,
      totalInJmd: monthEntries.reduce((sum, e) => sum + e.amountJmd, 0),
      entries: monthEntries,
    };
  });
}

/** Grand total cash in across `range` — a simple sum, exposed separately so the report header doesn't have to re-reduce the monthly rows. */
export function totalCashInJmd(rows: CashFlowMonthRow[]): number {
  return rows.reduce((sum, r) => sum + r.totalInJmd, 0);
}

/**
 * Reporting basis — PURE, no I/O.
 *
 * A financial statement is meaningless unless it says which basis it is on,
 * and catastrophic if it mixes two in one column. This module is the single
 * definition of the two bases and the row-selection rules that implement
 * them; lib/reports/incomeStatement.ts, lib/reports/cashflow.ts and the
 * report pages all read from here rather than each deciding for themselves.
 *
 *   ACCRUAL (default) — "what did the business earn and owe in this period",
 *   regardless of when money moved:
 *     · Revenue        = invoices ISSUED in the period (non-void), by
 *                        invoice date. NOT payments.
 *     · Cost of sales  = actual_costs by `incurred_date`.
 *     · Operating exp. = expenses by `incurred_date`.
 *
 *   CASH — "what actually moved through the bank in this period":
 *     · Revenue        = invoice_payments by `paid_at`.
 *     · Cost of sales  = actual_costs by `paid_date`; rows with a NULL
 *                        paid_date are EXCLUDED, not treated as paid today.
 *     · Operating exp. = expenses by `paid_date`; NULL likewise excluded.
 *
 * WHY EXCLUSION RATHER THAN A FALLBACK: a NULL paid_date means "we have not
 * recorded that this was paid". Falling back to `incurred_date` would put an
 * unpaid bill into a cash-basis figure and make the cash-flow statement
 * disagree with the bank. Excluding it can only ever understate cash spent,
 * and the report says so on screen — an understated figure a founder is
 * warned about beats an overstated one they are not.
 *
 * IMPLEMENTATION NOTE — WHY THIS IS "ROW SELECTION" AND NOT A SECOND ENGINE:
 * the arithmetic of a period P&L (bucket by month, sum, subtract, divide for
 * margin) is identical under both bases. Only WHICH rows carry WHICH date
 * differs. So each basis is expressed as a mapping from the raw rows onto
 * the already-tested primitives in lib/reports/pnl.ts, rather than as a
 * duplicated set of month-bucketing functions that could drift apart.
 */

export type ReportBasis = "accrual" | "cash";

export const REPORT_BASES: ReportBasis[] = ["accrual", "cash"];

export const REPORT_BASIS_LABELS: Record<ReportBasis, string> = {
  accrual: "Accrual",
  cash: "Cash",
};

/** One-line explanation shown next to the basis toggle and printed into every export header. */
export const REPORT_BASIS_DESCRIPTIONS: Record<ReportBasis, string> = {
  accrual:
    "Revenue is invoices issued in the period; cost of sales and operating expenses are dated when they were incurred, whether or not they have been paid.",
  cash: "Revenue is payments actually received; cost of sales and operating expenses count only what has actually been paid. Anything still unpaid is excluded.",
};

/** Column-header suffix so no figure can appear without its basis attached. */
export const REPORT_BASIS_SUFFIX: Record<ReportBasis, string> = {
  accrual: "accrual basis",
  cash: "cash basis",
};

/** Parses a `?basis=` query value. Anything unrecognised falls back to accrual — the default a real income statement is presented on. */
export function parseReportBasis(value: string | string[] | null | undefined): ReportBasis {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "cash" ? "cash" : "accrual";
}

/**
 * Income statement — PURE, no Supabase client, no I/O.
 *
 * This is the report the founder actually asked for: a real statement, not a
 * revenue-minus-cost pair.
 *
 *     Revenue
 *       less Cost of Sales            (actual_costs, by category)
 *     = Gross Profit                  (+ gross margin %)
 *       less Operating Expenses       (expenses, by expense category)
 *     = Net Profit                    (+ net margin %)
 *
 * DATA-SOURCE RULE (PRD §9.2) — UNCHANGED AND EXTENDED, NEVER WEAKENED.
 * Every figure here derives from real recorded data: `invoices` (issued),
 * `invoice_payments`, `actual_costs`, `expenses`. Nothing reads
 * `quotes.total_client_*` or `quote_line_items`. A `quoteRef` is carried
 * only as a display label and is never an input to a sum. The margin audit
 * remains the single, labelled exception in this codebase.
 *
 * BASIS: every figure is produced for exactly one basis (see
 * lib/reports/basis.ts). The two bases are implemented as row selection onto
 * lib/reports/pnl.ts's existing, tested month/order primitives — see
 * `revenueRowsForBasis` / `costRowsForBasis` below — so the arithmetic can
 * never diverge between them.
 *
 * WHY OPERATING EXPENSES ARE NOT IN THE PER-ORDER VIEW. Rent is not a cost
 * of any one shipment. Allocating it across orders would require an
 * allocation key that is an opinion, and would turn a measured number into
 * an invented one. So the per-order table is scoped, in its own heading, as
 * GROSS profit by order; net profit exists only at period level. This is the
 * same reasoning that leaves the margin audit untouched by the expenses
 * work.
 *
 * GCT IS NEVER REVENUE, ON EITHER BASIS. `invoices.amount_jmd` is
 * subtotal + GCT — the amount the client owes. GCT is collected on the
 * government's behalf and is a LIABILITY, not income. So:
 *   · accrual revenue = `invoices.subtotal_jmd` (GCT-exclusive by
 *     construction, see supabase/migrations/20260718000002_invoicing.sql);
 *   · cash revenue    = each payment PRO-RATED by its invoice's
 *     subtotal/amount ratio, because a part payment settles the GCT and the
 *     net in the same proportion the invoice was raised in.
 * The GCT actually collected is reported as a MEMO line beneath Net Profit —
 * visible, reconcilable against a GCT return, and unmistakably not revenue.
 * This is latent today (`gct_enabled` is false, so every ratio is 1.0) and
 * becomes load-bearing the moment GCT is switched on.
 */

import { monthKeyFromDateOnly, monthKeysInRange, isWithinReportRange, type ReportDateRange } from "./period";
import {
  computePnlByMonth,
  computePnlByOrder,
  mergeCategoryTotals,
  type PnlCostInput,
  type PnlMonthRow,
  type PnlOrderRow,
  type PnlPaymentInput,
  type OrderRateLookup,
} from "./pnl";
import type { ReportBasis } from "./basis";
import { expenseAmountJmd, type CurrentFxRate } from "../expenses/expense";
import type { ActualCostCategory } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** An invoice that has been ISSUED (non-void) — the ACCRUAL revenue event. */
export interface IssuedInvoiceInput {
  /** `invoices.amount_jmd` — subtotal + GCT, the amount the client owes. NOT revenue. */
  grossAmountJmd: number;
  /** `invoices.subtotal_jmd` — GCT-EXCLUSIVE. THIS is the revenue figure. */
  revenueJmd: number;
  /** `invoices.gct_amount_jmd` — collected for the government. A liability; memo line only. */
  gctJmd: number;
  /** `YYYY-MM-DD`, Jamaica-local, derived from `invoices.issued_at`. */
  issuedDateIso: string;
  orderId: string | null;
  quoteRef: string;
  invoiceNumber: string;
}

/**
 * A customer payment carrying its GCT split — the CASH revenue event.
 *
 * `amountJmd` (inherited) is the payment exactly as recorded: the full sum
 * that hit the bank, GCT included. `revenueJmd` is the GCT-exclusive share
 * that belongs on the Revenue line, and `gctJmd` is the remainder. The
 * cash-flow statement wants the former; the income statement wants the
 * latter — which is why both travel rather than one being derived downstream.
 */
export interface PaymentRevenueInput extends PnlPaymentInput {
  /** The GCT-exclusive share of this payment. */
  revenueJmd: number;
  /** `amountJmd` − `revenueJmd`. */
  gctJmd: number;
}

/**
 * The GCT-exclusive fraction of an invoice's gross amount, for pro-rating a
 * payment against it.
 *
 * Returns 1 (treat the whole payment as revenue) whenever the split cannot
 * be established: no recorded subtotal, or a zero/absent/non-finite gross.
 * Over-stating revenue is the honest failure mode here — the alternative,
 * inventing a GCT rate, would fabricate a tax liability.
 */
export function invoiceRevenueShare(
  subtotalJmd: number | null | undefined,
  grossAmountJmd: number | null | undefined,
): number {
  if (subtotalJmd == null || !Number.isFinite(subtotalJmd)) return 1;
  if (grossAmountJmd == null || !Number.isFinite(grossAmountJmd) || grossAmountJmd === 0) return 1;
  const share = subtotalJmd / grossAmountJmd;
  return Number.isFinite(share) ? share : 1;
}

/** Rounds to 2dp, so a pro-rated share never leaves float dust in a currency figure. */
export function roundJmd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** An actual cost, carrying BOTH of its dates so either basis can select it. */
export interface CostOfSalesInput extends PnlCostInput {
  /** `actual_costs.paid_date`. NULL = unpaid → excluded from the cash basis. */
  paidDateIso: string | null;
}

/** An operating expense, carrying BOTH of its dates. */
export interface OperatingExpenseInput {
  /** Stable snake_case machine key from `expense_categories.name`. */
  categoryName: string;
  /** Display string from `expense_categories.label`. */
  categoryLabel: string;
  amountJmd: number | null;
  amountUsd: number | null;
  incurredDateIso: string;
  /** `expenses.paid_date`. NULL = unpaid → excluded from the cash basis. */
  paidDateIso: string | null;
}

// ---------------------------------------------------------------------------
// Basis → row selection
// ---------------------------------------------------------------------------

/**
 * The revenue rows for a basis, expressed in `PnlPaymentInput` shape so the
 * existing month/order primitives can consume either.
 *
 * On the ACCRUAL basis an ISSUED INVOICE is mapped into that shape with
 * `paidAtIso` carrying the ISSUE date. The field name is a cash-basis
 * artifact of the original module; what it means here is "the date this
 * revenue event belongs to under the selected basis". Nothing about the
 * invoice is treated as a payment — no payment record is created, implied,
 * or double-counted, because on the accrual basis the `invoice_payments`
 * rows are not consulted at all.
 *
 * `amountJmd` on the rows this returns is the GCT-EXCLUSIVE revenue figure
 * on both bases (see module header). This function is the single place that
 * translation happens, so no downstream sum can accidentally pick up the
 * gross.
 */
export function revenueRowsForBasis(
  basis: ReportBasis,
  issuedInvoices: IssuedInvoiceInput[],
  payments: PaymentRevenueInput[],
): PnlPaymentInput[] {
  if (basis === "cash") {
    return payments.map((p) => ({
      amountJmd: p.revenueJmd,
      paidAtIso: p.paidAtIso,
      orderId: p.orderId,
      quoteRef: p.quoteRef,
      invoiceNumber: p.invoiceNumber,
    }));
  }
  return issuedInvoices.map((inv) => ({
    amountJmd: inv.revenueJmd,
    paidAtIso: inv.issuedDateIso,
    orderId: inv.orderId,
    quoteRef: inv.quoteRef,
    invoiceNumber: inv.invoiceNumber,
  }));
}

/**
 * The GCT collected in `range` on the selected basis — the memo line beneath
 * Net Profit. Accrual counts GCT billed on invoices issued in the period;
 * cash counts GCT actually received with the payments. Never added to any
 * revenue, profit or margin figure.
 */
export function gctCollectedJmd(
  basis: ReportBasis,
  issuedInvoices: IssuedInvoiceInput[],
  payments: PaymentRevenueInput[],
  range: ReportDateRange,
): number {
  const total =
    basis === "cash"
      ? payments.reduce((s, p) => (isWithinReportRange(p.paidAtIso, range) ? s + p.gctJmd : s), 0)
      : issuedInvoices.reduce((s, inv) => (isWithinReportRange(inv.issuedDateIso, range) ? s + inv.gctJmd : s), 0);
  return roundJmd(total);
}

/**
 * The cost-of-sales rows for a basis. On the cash basis, rows with no
 * `paidDateIso` are DROPPED (not re-dated to `incurredDateIso`) — see
 * lib/reports/basis.ts for why exclusion is the only honest choice — and the
 * survivors are re-dated onto their payment date.
 */
export function costRowsForBasis(basis: ReportBasis, costs: CostOfSalesInput[]): PnlCostInput[] {
  if (basis === "accrual") {
    return costs.map((c) => ({
      orderId: c.orderId,
      amountUsd: c.amountUsd,
      amountJmd: c.amountJmd,
      incurredDateIso: c.incurredDateIso,
      category: c.category,
      quoteRef: c.quoteRef,
    }));
  }
  const rows: PnlCostInput[] = [];
  for (const c of costs) {
    if (c.paidDateIso == null) continue;
    rows.push({
      orderId: c.orderId,
      amountUsd: c.amountUsd,
      amountJmd: c.amountJmd,
      incurredDateIso: c.paidDateIso,
      category: c.category,
      quoteRef: c.quoteRef,
    });
  }
  return rows;
}

/** The date an expense belongs to under a basis, or null when the basis excludes it entirely. */
export function expenseDateForBasis(basis: ReportBasis, expense: OperatingExpenseInput): string | null {
  return basis === "accrual" ? expense.incurredDateIso : expense.paidDateIso;
}

// ---------------------------------------------------------------------------
// Operating expenses
// ---------------------------------------------------------------------------

export interface OperatingExpenseCategoryTotal {
  categoryName: string;
  categoryLabel: string;
  amountJmd: number;
}

export interface OperatingExpenseMonthRow {
  monthKey: string;
  totalJmd: number;
  /** JMD subtotal per expense category — sums to `totalJmd`. Only categories with data appear (not zero-filled). */
  byCategory: OperatingExpenseCategoryTotal[];
  /**
   * USD subtotal of rows that could not be converted (USD-only with no
   * current rate configured). Surfaced so the UI flags an incomplete total
   * rather than silently under-reporting operating expenses.
   */
  unconvertedUsd: number;
}

/**
 * Monthly operating expenses across every month in `range` (zero-filled, same
 * rationale as computePnlByMonth: a founder scanning YTD should see every
 * month, not a gap that reads as missing data).
 */
export function computeOperatingExpensesByMonth(
  expenses: OperatingExpenseInput[],
  basis: ReportBasis,
  range: ReportDateRange,
  fx: CurrentFxRate,
): OperatingExpenseMonthRow[] {
  const totalByMonth = new Map<string, number>();
  const unconvertedByMonth = new Map<string, number>();
  // categoryName → { label, amount } per month, so the label travels with the
  // key and the UI never has to re-look-up a display string.
  const categoryByMonth = new Map<string, Map<string, OperatingExpenseCategoryTotal>>();

  for (const e of expenses) {
    const dateIso = expenseDateForBasis(basis, e);
    if (dateIso == null) continue;
    if (!isWithinReportRange(dateIso, range)) continue;
    const monthKey = monthKeyFromDateOnly(dateIso);

    const jmd = expenseAmountJmd(e, fx);
    if (jmd == null) {
      unconvertedByMonth.set(monthKey, (unconvertedByMonth.get(monthKey) ?? 0) + (e.amountUsd ?? 0));
      continue;
    }

    totalByMonth.set(monthKey, (totalByMonth.get(monthKey) ?? 0) + jmd);
    const cats = categoryByMonth.get(monthKey) ?? new Map<string, OperatingExpenseCategoryTotal>();
    const existing = cats.get(e.categoryName);
    if (existing) {
      existing.amountJmd += jmd;
    } else {
      cats.set(e.categoryName, {
        categoryName: e.categoryName,
        categoryLabel: e.categoryLabel,
        amountJmd: jmd,
      });
    }
    categoryByMonth.set(monthKey, cats);
  }

  return monthKeysInRange(range).map((monthKey) => ({
    monthKey,
    totalJmd: totalByMonth.get(monthKey) ?? 0,
    byCategory: sortCategoryTotals(Array.from(categoryByMonth.get(monthKey)?.values() ?? [])),
    unconvertedUsd: unconvertedByMonth.get(monthKey) ?? 0,
  }));
}

/** Largest first, then alphabetically by label so ties are stable across renders and exports. */
function sortCategoryTotals(totals: OperatingExpenseCategoryTotal[]): OperatingExpenseCategoryTotal[] {
  return totals
    .slice()
    .sort((a, b) => b.amountJmd - a.amountJmd || a.categoryLabel.localeCompare(b.categoryLabel));
}

/** Merges per-month expense-category subtotals into one period-level breakdown. */
export function mergeOperatingExpenseCategories(
  rows: OperatingExpenseMonthRow[],
): OperatingExpenseCategoryTotal[] {
  const merged = new Map<string, OperatingExpenseCategoryTotal>();
  for (const row of rows) {
    for (const cat of row.byCategory) {
      const existing = merged.get(cat.categoryName);
      if (existing) existing.amountJmd += cat.amountJmd;
      else merged.set(cat.categoryName, { ...cat });
    }
  }
  return sortCategoryTotals(Array.from(merged.values()));
}

// ---------------------------------------------------------------------------
// The statement itself
// ---------------------------------------------------------------------------

/** One column of the statement — a month, or the period total. Every figure in a column shares one basis. */
export interface IncomeStatementColumn {
  /** `YYYY-MM`, or `"total"` for the period column. */
  key: string;
  label: string;
  revenueJmd: number;
  costOfSalesJmd: number;
  grossProfitJmd: number;
  /** Gross profit as a % of revenue. Null when revenue is zero — a margin on nothing is undefined, not 0%. */
  grossMarginPct: number | null;
  operatingExpensesJmd: number;
  netProfitJmd: number;
  /** Net profit as a % of revenue. Null when revenue is zero. */
  netMarginPct: number | null;
}

export interface IncomeStatement {
  basis: ReportBasis;
  range: ReportDateRange;
  months: IncomeStatementColumn[];
  total: IncomeStatementColumn;
  /** Cost-of-sales subtotals per actual-cost category, period-wide, largest first. */
  costOfSalesByCategory: [ActualCostCategory, number][];
  /** Operating-expense subtotals per expense category, period-wide, largest first. */
  operatingExpensesByCategory: OperatingExpenseCategoryTotal[];
  /** Gross profit per order — no operating expenses, deliberately (see module header). */
  grossProfitByOrder: PnlOrderRow[];
  /** USD cost-of-sales that had no order-locked rate and is excluded from every JMD figure above. */
  unconvertedCostOfSalesUsd: number;
  /** USD operating expenses that had no current rate and are excluded from every JMD figure above. */
  unconvertedOperatingExpensesUsd: number;
  /**
   * MEMO ONLY — GCT collected in the period on this basis. Not revenue, not
   * income, and not part of any figure above: it is money held on the
   * government's behalf. Rendered beneath Net Profit so it can be
   * reconciled against a GCT return without ever being mistaken for a
   * trading figure.
   */
  gctCollectedJmd: number;
  /** True when any USD-only operating expense WAS converted, so the UI must disclose the live-rate caveat. */
  usedCurrentRateConversion: boolean;
}

function marginPct(numerator: number, revenue: number): number | null {
  return revenue > 0 ? (numerator / revenue) * 100 : null;
}

function columnFrom(
  key: string,
  label: string,
  revenueJmd: number,
  costOfSalesJmd: number,
  operatingExpensesJmd: number,
): IncomeStatementColumn {
  const grossProfitJmd = revenueJmd - costOfSalesJmd;
  const netProfitJmd = grossProfitJmd - operatingExpensesJmd;
  return {
    key,
    label,
    revenueJmd,
    costOfSalesJmd,
    grossProfitJmd,
    grossMarginPct: marginPct(grossProfitJmd, revenueJmd),
    operatingExpensesJmd,
    netProfitJmd,
    netMarginPct: marginPct(netProfitJmd, revenueJmd),
  };
}

export interface IncomeStatementInputs {
  issuedInvoices: IssuedInvoiceInput[];
  payments: PaymentRevenueInput[];
  costs: CostOfSalesInput[];
  expenses: OperatingExpenseInput[];
  rateByOrderId: OrderRateLookup;
  fx: CurrentFxRate;
}

/**
 * Builds the complete statement for one basis. Callers render exactly one
 * basis at a time — there is no code path that puts an accrual figure and a
 * cash figure in the same column.
 */
export function buildIncomeStatement(
  inputs: IncomeStatementInputs,
  range: ReportDateRange,
  basis: ReportBasis,
): IncomeStatement {
  const revenueRows = revenueRowsForBasis(basis, inputs.issuedInvoices, inputs.payments);
  const costRows = costRowsForBasis(basis, inputs.costs);

  const pnlMonths: PnlMonthRow[] = computePnlByMonth(revenueRows, costRows, inputs.rateByOrderId, range);
  const opexMonths = computeOperatingExpensesByMonth(inputs.expenses, basis, range, inputs.fx);
  const opexByMonthKey = new Map(opexMonths.map((r) => [r.monthKey, r]));

  const months = pnlMonths.map((m) =>
    columnFrom(m.monthKey, m.monthKey, m.revenueJmd, m.costJmd, opexByMonthKey.get(m.monthKey)?.totalJmd ?? 0),
  );

  const totalRevenue = pnlMonths.reduce((s, m) => s + m.revenueJmd, 0);
  const totalCostOfSales = pnlMonths.reduce((s, m) => s + m.costJmd, 0);
  const totalOpex = opexMonths.reduce((s, m) => s + m.totalJmd, 0);

  const costOfSalesByCategory = (
    Object.entries(mergeCategoryTotals(pnlMonths)) as [ActualCostCategory, number][]
  ).sort((a, b) => b[1] - a[1]);

  return {
    basis,
    range,
    months,
    total: columnFrom("total", "Period total", totalRevenue, totalCostOfSales, totalOpex),
    costOfSalesByCategory,
    operatingExpensesByCategory: mergeOperatingExpenseCategories(opexMonths),
    grossProfitByOrder: computePnlByOrder(revenueRows, costRows, inputs.rateByOrderId, range),
    unconvertedCostOfSalesUsd: pnlMonths.reduce((s, m) => s + m.unconvertedCostUsd, 0),
    unconvertedOperatingExpensesUsd: opexMonths.reduce((s, m) => s + m.unconvertedUsd, 0),
    gctCollectedJmd: gctCollectedJmd(basis, inputs.issuedInvoices, inputs.payments, range),
    usedCurrentRateConversion: inputs.expenses.some((e) => usesCurrentRate(e, basis, range)),
  };
}

/**
 * True when this expense contributes a CONVERTED (rather than natively
 * recorded) JMD figure to the selected basis/range — i.e. it is USD-only and
 * in scope. Drives the UI's "these figures include a conversion at today's
 * rate" disclosure, which must appear only when it is actually true.
 */
function usesCurrentRate(e: OperatingExpenseInput, basis: ReportBasis, range: ReportDateRange): boolean {
  if (e.amountJmd != null || e.amountUsd == null) return false;
  const dateIso = expenseDateForBasis(basis, e);
  return dateIso != null && isWithinReportRange(dateIso, range);
}

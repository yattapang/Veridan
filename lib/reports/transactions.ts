/**
 * Transaction detail (general ledger) — PURE, no I/O.
 *
 * THIS IS THE REPORT THE ACCOUNTANT ACTUALLY WORKS FROM. One unified,
 * chronological listing of every financial transaction Veridan recorded in a
 * period, with enough context per row that an external accountant can post
 * it in their own software without asking a follow-up question:
 *
 *     date · type · reference · party · category · description ·
 *     amount JMD · amount USD · incurred date · paid date · FX basis
 *
 * It is NOT a double-entry journal. There are no debits, credits, contra
 * accounts, or a trial balance — the founder explicitly declined a full
 * double-entry system. Each row is one recorded business event with its own
 * sign convention stated by `type` (money in vs. money out), which is what a
 * clean import into the accountant's package needs.
 *
 * THE FOUR SOURCES, AND WHICH DATE ORDERS THEM. The ledger merges:
 *   · Invoice Issued     ← invoices           (money in, ACCRUAL basis only)
 *   · Customer Payment   ← invoice_payments   (money in, CASH basis only)
 *   · Cost of Sales      ← actual_costs       (money out, order-attributable)
 *   · Operating Expense  ← expenses           (money out, not order-attributable)
 *
 * THIS LEDGER IS BASIS-AWARE, AND MUST BE. It is the accountant's
 * RECONCILIATION document: its Money in / Money out totals have to equal the
 * income statement's Revenue and (Cost of sales + Operating expenses) for
 * the same period. It previously dated revenue on a CASH date (`paid_at`)
 * while dating costs and expenses on an ACCRUAL date (`incurred_date`), then
 * summed the two into one unlabelled total — a figure that reconciled to
 * neither statement. Worse, it had no invoice row at all, so the DEFAULT
 * (accrual) Revenue line had no row-level support anywhere in the
 * accountant's own export.
 *
 * So every row is placed at its BASIS-APPROPRIATE date, and the basis is
 * stated on the totals:
 *   ACCRUAL — invoices at `issued_at`; costs/expenses at `incurred_date`;
 *             payments are not listed at all (they are not revenue events on
 *             this basis, and listing them would double-count the invoice).
 *   CASH    — payments at `paid_at`; costs/expenses at `paid_date`, with
 *             NULL-paid_date rows DROPPED (nothing has moved); invoices are
 *             not listed at all.
 * Both dates still travel on every row (`incurredDateIso` / `paidDateIso`)
 * so an accountant can see the other side of each item without re-running
 * the report.
 *
 * NATIVE AMOUNTS ARE NEVER OVERWRITTEN. `amountJmd` / `amountUsd` are
 * exactly what was recorded. `resolvedJmd` is a separate, clearly-derived
 * single-currency figure for totalling, and `fxBasis` states per row how it
 * was arrived at — native, an order's locked quote rate, or the current
 * parameter rate. A row that could not be converted carries a null
 * `resolvedJmd` and `fxBasis: "unconverted"` rather than a zero.
 *
 * ON A REVENUE ROW, `resolvedJmd` IS NET OF GCT and `gctJmd` carries the
 * remainder, so `amountJmd` (gross, as recorded) = `resolvedJmd` + `gctJmd`.
 * GCT is collected for the government and is never revenue — see
 * lib/reports/incomeStatement.ts's header. This is what lets the Money in
 * total equal the statement's Revenue line exactly.
 */

import type { ReportBasis } from "./basis";
import { isWithinReportRange, type ReportDateRange } from "./period";
import { costAmountJmd, type OrderRateLookup } from "./pnl";
import { expenseAmountJmd, type CurrentFxRate } from "../expenses/expense";
import {
  roundJmd,
  type CostOfSalesInput,
  type IssuedInvoiceInput,
  type OperatingExpenseInput,
  type PaymentRevenueInput,
} from "./incomeStatement";
import { ACTUAL_COST_CATEGORY_LABELS } from "../orders/format";

export type TransactionType =
  | "invoice_issued"
  | "customer_payment"
  | "cost_of_sales"
  | "operating_expense";

export const TRANSACTION_TYPES: TransactionType[] = [
  "invoice_issued",
  "customer_payment",
  "cost_of_sales",
  "operating_expense",
];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  invoice_issued: "Invoice Issued",
  customer_payment: "Customer Payment",
  cost_of_sales: "Cost of Sales",
  operating_expense: "Operating Expense",
};

/** Money in (+1) or money out (-1). Stated per type so a caller never has to infer a sign from a label. */
export const TRANSACTION_DIRECTION: Record<TransactionType, 1 | -1> = {
  invoice_issued: 1,
  customer_payment: 1,
  cost_of_sales: -1,
  operating_expense: -1,
};

/**
 * The types that can appear on a given basis. Two of the four are
 * basis-exclusive revenue events, so offering a founder a filter chip for a
 * type the current basis can never produce would read as "no data" rather
 * than "wrong basis".
 */
export function transactionTypesForBasis(basis: ReportBasis): TransactionType[] {
  return basis === "cash"
    ? ["customer_payment", "cost_of_sales", "operating_expense"]
    : ["invoice_issued", "cost_of_sales", "operating_expense"];
}

/** How a row's `resolvedJmd` was arrived at. Rendered per row so no converted figure is ever mistaken for a recorded one. */
export type TransactionFxBasis = "native" | "order_rate" | "current_rate" | "unconverted";

export const TRANSACTION_FX_BASIS_LABELS: Record<TransactionFxBasis, string> = {
  native: "Recorded in JMD",
  order_rate: "Converted at the order's quote-locked rate",
  current_rate: "Converted at today's parameter rate",
  unconverted: "Not converted — no rate available",
};

export interface TransactionRow {
  /** The row's date under the ledger's basis (`YYYY-MM-DD`) — see module header. */
  dateIso: string;
  type: TransactionType;
  /** Invoice number, quote ref, or the expense's own reference. Null when none was recorded. */
  reference: string | null;
  /** Client company for money in; supplier or vendor for money out. */
  party: string | null;
  /** Display label of the cost/expense category; "—" for a revenue row, which has none. */
  category: string;
  description: string | null;
  /** Exactly as recorded — never derived. On a revenue row this is the GROSS figure, GCT included. */
  amountJmd: number | null;
  /** Exactly as recorded — never derived. */
  amountUsd: number | null;
  /** Single-currency figure for totalling; NET of GCT on a revenue row. Null when no rate was available. */
  resolvedJmd: number | null;
  /** GCT portion of a revenue row (`amountJmd` − `resolvedJmd`). Always 0 on a money-out row. */
  gctJmd: number;
  fxBasis: TransactionFxBasis;
  /** Accrual-basis date. Null for a customer payment, which has no separate incurred date. */
  incurredDateIso: string | null;
  /** Cash-basis date. Null means unpaid (and therefore absent from every cash-basis figure). */
  paidDateIso: string | null;
}

// ---------------------------------------------------------------------------
// Source-specific inputs (the two cost shapes are reused verbatim from the
// income statement so the ledger and the statement can never disagree about
// what a cost row is)
// ---------------------------------------------------------------------------

/** An issued invoice — the ACCRUAL revenue event — plus the ledger-only context columns. */
export interface LedgerInvoiceInput extends IssuedInvoiceInput {
  /** The client billed. */
  companyName: string | null;
}

/** A customer payment, plus the ledger-only context columns. */
export interface LedgerPaymentInput extends PaymentRevenueInput {
  companyName: string | null;
  method: string | null;
  reference: string | null;
}

export interface LedgerCostInput extends CostOfSalesInput {
  description: string | null;
  supplierName: string | null;
  companyName: string | null;
}

export interface LedgerExpenseInput extends OperatingExpenseInput {
  description: string;
  vendor: string | null;
  reference: string | null;
}

// ---------------------------------------------------------------------------
// Row construction
// ---------------------------------------------------------------------------

/**
 * The ACCRUAL revenue row. `resolvedJmd` is the GCT-exclusive subtotal, which
 * is exactly what the income statement's Revenue line sums; the gross stays
 * visible in `amountJmd` and the difference is spelled out in `gctJmd`.
 */
function invoiceRow(inv: LedgerInvoiceInput): TransactionRow {
  return {
    dateIso: inv.issuedDateIso,
    type: "invoice_issued",
    reference: inv.invoiceNumber,
    party: inv.companyName,
    category: "—",
    description: `Invoice issued against ${inv.quoteRef}`,
    amountJmd: inv.grossAmountJmd,
    amountUsd: null,
    resolvedJmd: inv.revenueJmd,
    gctJmd: inv.gctJmd,
    fxBasis: "native",
    // The issue date IS the accrual date for this event.
    incurredDateIso: inv.issuedDateIso,
    // Settlement is tracked on the payment rows, not here — an invoice row
    // deliberately does not claim to know whether it was paid.
    paidDateIso: null,
  };
}

function paymentRow(p: LedgerPaymentInput): TransactionRow {
  return {
    dateIso: p.paidAtIso,
    type: "customer_payment",
    // The invoice number is the accountant's primary handle; the payment's
    // own bank reference is appended when there is one, since that is what
    // reconciles against a bank statement line.
    reference: p.reference ? `${p.invoiceNumber} / ${p.reference}` : p.invoiceNumber,
    party: p.companyName,
    category: "—",
    description: p.method ? `Payment received (${p.method}) against ${p.quoteRef}` : `Payment received against ${p.quoteRef}`,
    amountJmd: p.amountJmd,
    amountUsd: null,
    resolvedJmd: p.revenueJmd,
    gctJmd: p.gctJmd,
    fxBasis: "native",
    // A payment IS the cash event — there is no separate incurred date, and
    // inventing one (e.g. the invoice's issue date) would put a second,
    // different meaning into the same column.
    incurredDateIso: null,
    paidDateIso: p.paidAtIso,
  };
}

function costRow(c: LedgerCostInput, dateIso: string, rateByOrderId: OrderRateLookup): TransactionRow {
  const resolvedJmd = costAmountJmd(c, rateByOrderId);
  const fxBasis: TransactionFxBasis =
    c.amountJmd != null ? "native" : resolvedJmd != null ? "order_rate" : "unconverted";
  return {
    dateIso,
    type: "cost_of_sales",
    reference: c.quoteRef,
    party: c.supplierName ?? c.companyName,
    category: ACTUAL_COST_CATEGORY_LABELS[c.category],
    description: c.description,
    amountJmd: c.amountJmd,
    amountUsd: c.amountUsd,
    resolvedJmd,
    gctJmd: 0,
    fxBasis,
    incurredDateIso: c.incurredDateIso,
    paidDateIso: c.paidDateIso,
  };
}

function expenseRow(e: LedgerExpenseInput, dateIso: string, fx: CurrentFxRate): TransactionRow {
  const resolvedJmd = expenseAmountJmd(e, fx);
  const fxBasis: TransactionFxBasis =
    e.amountJmd != null ? "native" : resolvedJmd != null ? "current_rate" : "unconverted";
  return {
    dateIso,
    type: "operating_expense",
    reference: e.reference,
    party: e.vendor,
    category: e.categoryLabel,
    description: e.description,
    amountJmd: e.amountJmd,
    amountUsd: e.amountUsd,
    resolvedJmd,
    gctJmd: 0,
    fxBasis,
    incurredDateIso: e.incurredDateIso,
    paidDateIso: e.paidDateIso,
  };
}

// ---------------------------------------------------------------------------
// Merge + ordering
// ---------------------------------------------------------------------------

// Distinct ranks for all four (the two revenue types never co-occur in one
// ledger, but a shared rank would make `compareRows` return 0 for them and
// skip the reference/description tiebreaks that make exports byte-stable).
const TYPE_ORDER: Record<TransactionType, number> = {
  invoice_issued: 0,
  customer_payment: 1,
  cost_of_sales: 2,
  operating_expense: 3,
};

/**
 * Total ordering: date, then type, then reference, then description, then
 * amount. Fully deterministic with no reliance on input order — two runs
 * over the same data always produce byte-identical exports, which is what
 * makes an accountant's diff between two downloads meaningful.
 */
function compareRows(a: TransactionRow, b: TransactionRow): number {
  if (a.dateIso !== b.dateIso) return a.dateIso.localeCompare(b.dateIso);
  if (a.type !== b.type) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  const refA = a.reference ?? "";
  const refB = b.reference ?? "";
  if (refA !== refB) return refA.localeCompare(refB);
  const descA = a.description ?? "";
  const descB = b.description ?? "";
  if (descA !== descB) return descA.localeCompare(descB);
  return (a.resolvedJmd ?? 0) - (b.resolvedJmd ?? 0);
}

export interface TransactionLedgerInputs {
  /** Issued, non-void invoices — used on the ACCRUAL basis only. */
  issuedInvoices: LedgerInvoiceInput[];
  /** Recorded payments — used on the CASH basis only. */
  payments: LedgerPaymentInput[];
  costs: LedgerCostInput[];
  expenses: LedgerExpenseInput[];
  rateByOrderId: OrderRateLookup;
  fx: CurrentFxRate;
}

export interface TransactionLedgerFilters {
  /** Empty or omitted = every type the basis produces. */
  types?: TransactionType[];
}

export interface TransactionLedger {
  rows: TransactionRow[];
  range: ReportDateRange;
  /** The basis every row was dated and every total was computed on. */
  basis: ReportBasis;
  /** Sum of `resolvedJmd` for money-in rows — equals the income statement's Revenue for the same period and basis. */
  totalInJmd: number;
  /** Sum of `resolvedJmd` for money-out rows, as a positive number — equals Cost of sales + Operating expenses. */
  totalOutJmd: number;
  /** totalInJmd − totalOutJmd — equals the statement's Net profit. */
  netJmd: number;
  /** MEMO — GCT on the money-in rows. Excluded from every total above; not revenue. */
  gctCollectedJmd: number;
  /** Count of rows whose amount could not be resolved to JMD and is therefore missing from the totals. */
  unresolvedRowCount: number;
  /** Their USD face value, so the shortfall is quantified rather than merely counted. */
  unresolvedUsd: number;
}

/**
 * Builds the ledger for ONE basis: select the basis's revenue source, date
 * every row on that basis, filter to `range` and by type, sort, and total.
 *
 * The result is a reconciliation document — see the module header. For the
 * same inputs, range and basis:
 *   totalInJmd  === buildIncomeStatement(...).total.revenueJmd
 *   totalOutJmd === total.costOfSalesJmd + total.operatingExpensesJmd
 *   netJmd      === total.netProfitJmd
 * (up to rows excluded from both for want of an FX rate, which each report
 * reports separately rather than counting as zero).
 */
export function buildTransactionLedger(
  inputs: TransactionLedgerInputs,
  range: ReportDateRange,
  basis: ReportBasis,
  filters: TransactionLedgerFilters = {},
): TransactionLedger {
  const typeFilter = filters.types && filters.types.length > 0 ? new Set(filters.types) : null;

  const revenueRows: TransactionRow[] =
    basis === "cash" ? inputs.payments.map(paymentRow) : inputs.issuedInvoices.map(invoiceRow);

  const costRows: TransactionRow[] =
    basis === "cash"
      ? // An unpaid cost has moved no money, so it has no cash-basis date and
        // is dropped outright rather than re-dated onto its incurred date.
        inputs.costs.flatMap((c) => (c.paidDateIso == null ? [] : [costRow(c, c.paidDateIso, inputs.rateByOrderId)]))
      : inputs.costs.map((c) => costRow(c, c.incurredDateIso, inputs.rateByOrderId));

  const expenseRows: TransactionRow[] =
    basis === "cash"
      ? inputs.expenses.flatMap((e) => (e.paidDateIso == null ? [] : [expenseRow(e, e.paidDateIso, inputs.fx)]))
      : inputs.expenses.map((e) => expenseRow(e, e.incurredDateIso, inputs.fx));

  const rows: TransactionRow[] = [...revenueRows, ...costRows, ...expenseRows]
    .filter((r) => isWithinReportRange(r.dateIso, range))
    .filter((r) => (typeFilter ? typeFilter.has(r.type) : true))
    .sort(compareRows);

  let totalInJmd = 0;
  let totalOutJmd = 0;
  let gctCollected = 0;
  let unresolvedRowCount = 0;
  let unresolvedUsd = 0;

  for (const row of rows) {
    if (row.resolvedJmd == null) {
      unresolvedRowCount += 1;
      unresolvedUsd += row.amountUsd ?? 0;
      continue;
    }
    if (TRANSACTION_DIRECTION[row.type] === 1) {
      totalInJmd += row.resolvedJmd;
      gctCollected += row.gctJmd;
    } else {
      totalOutJmd += row.resolvedJmd;
    }
  }

  return {
    rows,
    range,
    basis,
    // Deliberately NOT rounded: the income statement's totals are raw sums of
    // the same per-row figures, and rounding only one side of a
    // reconciliation is how a half-cent discrepancy gets introduced.
    // `gctCollectedJmd` IS rounded, to match `IncomeStatement.gctCollectedJmd`.
    totalInJmd,
    totalOutJmd,
    netJmd: totalInJmd - totalOutJmd,
    gctCollectedJmd: roundJmd(gctCollected),
    unresolvedRowCount,
    unresolvedUsd,
  };
}

/** Parses a repeated/comma-joined `?type=` query value into a validated filter list. */
export function parseTransactionTypes(value: string | string[] | null | undefined): TransactionType[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  const flattened = raw.flatMap((v) => v.split(",")).map((v) => v.trim());
  const selected = flattened.filter((v): v is TransactionType =>
    (TRANSACTION_TYPES as string[]).includes(v),
  );
  return Array.from(new Set(selected));
}

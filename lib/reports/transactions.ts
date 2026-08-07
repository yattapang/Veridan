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
 * THE THREE SOURCES, AND WHICH DATE ORDERS THEM. The ledger merges:
 *   · Customer Payment   ← invoice_payments   (money in)
 *   · Cost of Sales      ← actual_costs       (money out, order-attributable)
 *   · Operating Expense  ← expenses           (money out, not order-attributable)
 *
 * Each row is placed at its PRIMARY date: a payment's `paid_at`, a cost's
 * `incurred_date`, an expense's `incurred_date`. Deliberately one fixed
 * date rather than a basis-dependent one — this listing is the raw record
 * both bases are derived FROM, so it must not shift underneath a founder who
 * flips a toggle on another page. Both dates travel on every row
 * (`incurredDateIso` / `paidDateIso`) so the accountant can re-cut it on
 * either basis themselves, and an unpaid row is visibly unpaid.
 *
 * NATIVE AMOUNTS ARE NEVER OVERWRITTEN. `amountJmd` / `amountUsd` are
 * exactly what was recorded. `resolvedJmd` is a separate, clearly-derived
 * single-currency figure for totalling, and `fxBasis` states per row how it
 * was arrived at — native, an order's locked quote rate, or the current
 * parameter rate. A row that could not be converted carries a null
 * `resolvedJmd` and `fxBasis: "unconverted"` rather than a zero.
 */

import { isWithinReportRange, type ReportDateRange } from "./period";
import { costAmountJmd, type OrderRateLookup, type PnlPaymentInput } from "./pnl";
import { expenseAmountJmd, type CurrentFxRate } from "../expenses/expense";
import type { CostOfSalesInput, OperatingExpenseInput } from "./incomeStatement";
import { ACTUAL_COST_CATEGORY_LABELS } from "../orders/format";

export type TransactionType = "customer_payment" | "cost_of_sales" | "operating_expense";

export const TRANSACTION_TYPES: TransactionType[] = ["customer_payment", "cost_of_sales", "operating_expense"];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  customer_payment: "Customer Payment",
  cost_of_sales: "Cost of Sales",
  operating_expense: "Operating Expense",
};

/** Money in (+1) or money out (-1). Stated per type so a caller never has to infer a sign from a label. */
export const TRANSACTION_DIRECTION: Record<TransactionType, 1 | -1> = {
  customer_payment: 1,
  cost_of_sales: -1,
  operating_expense: -1,
};

/** How a row's `resolvedJmd` was arrived at. Rendered per row so no converted figure is ever mistaken for a recorded one. */
export type TransactionFxBasis = "native" | "order_rate" | "current_rate" | "unconverted";

export const TRANSACTION_FX_BASIS_LABELS: Record<TransactionFxBasis, string> = {
  native: "Recorded in JMD",
  order_rate: "Converted at the order's quote-locked rate",
  current_rate: "Converted at today's parameter rate",
  unconverted: "Not converted — no rate available",
};

export interface TransactionRow {
  /** The row's primary, ordering date (`YYYY-MM-DD`) — see module header. */
  dateIso: string;
  type: TransactionType;
  /** Invoice number, quote ref, or the expense's own reference. Null when none was recorded. */
  reference: string | null;
  /** Client company for money in; supplier or vendor for money out. */
  party: string | null;
  /** Display label of the cost/expense category; "—" for a customer payment, which has none. */
  category: string;
  description: string | null;
  /** Exactly as recorded — never derived. */
  amountJmd: number | null;
  /** Exactly as recorded — never derived. */
  amountUsd: number | null;
  /** Single-currency figure for totalling. Null when no rate was available. */
  resolvedJmd: number | null;
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

/** A customer payment, plus the ledger-only context columns. */
export interface LedgerPaymentInput extends PnlPaymentInput {
  companyName: string | null;
  method: string | null;
  reference: string | null;
}

export interface LedgerCostInput extends CostOfSalesInput {
  description: string | null;
  supplierName: string | null;
  quoteRef: string;
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
    resolvedJmd: p.amountJmd,
    fxBasis: "native",
    // A payment IS the cash event — there is no separate incurred date, and
    // inventing one (e.g. the invoice's issue date) would put a second,
    // different meaning into the same column.
    incurredDateIso: null,
    paidDateIso: p.paidAtIso,
  };
}

function costRow(c: LedgerCostInput, rateByOrderId: OrderRateLookup): TransactionRow {
  const resolvedJmd = costAmountJmd(c, rateByOrderId);
  const fxBasis: TransactionFxBasis =
    c.amountJmd != null ? "native" : resolvedJmd != null ? "order_rate" : "unconverted";
  return {
    dateIso: c.incurredDateIso,
    type: "cost_of_sales",
    reference: c.quoteRef,
    party: c.supplierName ?? c.companyName,
    category: ACTUAL_COST_CATEGORY_LABELS[c.category],
    description: c.description,
    amountJmd: c.amountJmd,
    amountUsd: c.amountUsd,
    resolvedJmd,
    fxBasis,
    incurredDateIso: c.incurredDateIso,
    paidDateIso: c.paidDateIso,
  };
}

function expenseRow(e: LedgerExpenseInput, fx: CurrentFxRate): TransactionRow {
  const resolvedJmd = expenseAmountJmd(e, fx);
  const fxBasis: TransactionFxBasis =
    e.amountJmd != null ? "native" : resolvedJmd != null ? "current_rate" : "unconverted";
  return {
    dateIso: e.incurredDateIso,
    type: "operating_expense",
    reference: e.reference,
    party: e.vendor,
    category: e.categoryLabel,
    description: e.description,
    amountJmd: e.amountJmd,
    amountUsd: e.amountUsd,
    resolvedJmd,
    fxBasis,
    incurredDateIso: e.incurredDateIso,
    paidDateIso: e.paidDateIso,
  };
}

// ---------------------------------------------------------------------------
// Merge + ordering
// ---------------------------------------------------------------------------

const TYPE_ORDER: Record<TransactionType, number> = {
  customer_payment: 0,
  cost_of_sales: 1,
  operating_expense: 2,
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
  payments: LedgerPaymentInput[];
  costs: LedgerCostInput[];
  expenses: LedgerExpenseInput[];
  rateByOrderId: OrderRateLookup;
  fx: CurrentFxRate;
}

export interface TransactionLedgerFilters {
  /** Empty or omitted = every type. */
  types?: TransactionType[];
}

export interface TransactionLedger {
  rows: TransactionRow[];
  range: ReportDateRange;
  /** Sum of `resolvedJmd` for money-in rows. */
  totalInJmd: number;
  /** Sum of `resolvedJmd` for money-out rows, as a positive number. */
  totalOutJmd: number;
  /** totalInJmd − totalOutJmd. */
  netJmd: number;
  /** Count of rows whose amount could not be resolved to JMD and is therefore missing from the totals. */
  unresolvedRowCount: number;
  /** Their USD face value, so the shortfall is quantified rather than merely counted. */
  unresolvedUsd: number;
}

/**
 * Builds the ledger: merge, filter to `range` by each row's primary date,
 * filter by type, sort, and total.
 */
export function buildTransactionLedger(
  inputs: TransactionLedgerInputs,
  range: ReportDateRange,
  filters: TransactionLedgerFilters = {},
): TransactionLedger {
  const typeFilter = filters.types && filters.types.length > 0 ? new Set(filters.types) : null;

  const rows: TransactionRow[] = [
    ...inputs.payments.map(paymentRow),
    ...inputs.costs.map((c) => costRow(c, inputs.rateByOrderId)),
    ...inputs.expenses.map((e) => expenseRow(e, inputs.fx)),
  ]
    .filter((r) => isWithinReportRange(r.dateIso, range))
    .filter((r) => (typeFilter ? typeFilter.has(r.type) : true))
    .sort(compareRows);

  let totalInJmd = 0;
  let totalOutJmd = 0;
  let unresolvedRowCount = 0;
  let unresolvedUsd = 0;

  for (const row of rows) {
    if (row.resolvedJmd == null) {
      unresolvedRowCount += 1;
      unresolvedUsd += row.amountUsd ?? 0;
      continue;
    }
    if (TRANSACTION_DIRECTION[row.type] === 1) totalInJmd += row.resolvedJmd;
    else totalOutJmd += row.resolvedJmd;
  }

  return {
    rows,
    range,
    totalInJmd,
    totalOutJmd,
    netJmd: totalInJmd - totalOutJmd,
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

/**
 * Report → CSV-row serializers (Task 56) — PURE, no I/O. Each returns a
 * matrix of cells for lib/reports/csv.ts's buildCsvDocument. Amounts are
 * emitted as raw 2-dp numbers (no currency symbols, no thousands separators)
 * so the accountant's spreadsheet re-parses every value as a number; the
 * column HEADER states the currency instead. A leading title/date-range block
 * makes each export self-describing when opened months later.
 */

import { REPORT_BASIS_DESCRIPTIONS, REPORT_BASIS_LABELS, REPORT_BASIS_SUFFIX, type ReportBasis } from "./basis";
import { CASH_OUT_KIND_LABELS, type CashFlowMonthRow } from "./cashflow";
import type { IncomeStatement, IncomeStatementColumn } from "./incomeStatement";
import type { MarginAuditReport } from "./marginAudit";
import { VARIANCE_CATEGORY_LABELS } from "./marginAudit";
import type { ReportDateRange } from "./period";
import type { OrdersRawRow } from "./load";
import {
  TRANSACTION_FX_BASIS_LABELS,
  TRANSACTION_TYPE_LABELS,
  type TransactionLedger,
} from "./transactions";
import type { CsvCell } from "./csv";
import { ACTUAL_COST_CATEGORY_LABELS } from "../orders/format";
import { ACTUAL_COST_CATEGORIES, type ActualCostCategory } from "../supabase/types";

function round2(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round1(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

function titleBlock(title: string, range: ReportDateRange): CsvCell[][] {
  return [
    [title],
    [`Period: ${range.startIso} to ${range.endIso}`],
    [],
  ];
}

// ---------------------------------------------------------------------------
// Shared: cost-of-sales category columns
// ---------------------------------------------------------------------------

/** Fixed column order for the per-category cost breakdown — stable across exports so an accountant's saved pivot/formula references don't shift when a category happens to have no data in a given period. */
const CATEGORY_COLUMNS: ActualCostCategory[] = ACTUAL_COST_CATEGORIES;

function categoryHeaders(): CsvCell[] {
  return CATEGORY_COLUMNS.map((cat) => `${ACTUAL_COST_CATEGORY_LABELS[cat]} (JMD)`);
}

/** One cell per fixed category column, in `CATEGORY_COLUMNS` order — a category absent from `byCategory` (no cost data) is emitted as 0, not blank, so every row sums cleanly across the category columns. */
function categoryCells(byCategory: Partial<Record<ActualCostCategory, number>>): CsvCell[] {
  return CATEGORY_COLUMNS.map((cat) => round2(byCategory[cat] ?? 0));
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

/**
 * The cash-flow STATEMENT: a monthly summary block (in / out / net / running
 * balance) followed by the per-transaction detail for both directions. Cash
 * out is emitted as a positive number in its own column rather than a
 * negative in the "in" column, so a spreadsheet SUM over either column is
 * meaningful on its own.
 */
export function cashFlowToCsvRows(monthly: CashFlowMonthRow[], range: ReportDateRange): CsvCell[][] {
  const rows: CsvCell[][] = titleBlock("Veridan — Cash flow statement (cash basis)", range);
  rows.push([
    "Cash basis by definition: only payments actually received and bills actually paid appear. Unpaid costs and expenses are excluded.",
  ]);
  rows.push([
    "Opening/closing balances are cumulative movement within the selected period, starting at zero — they are not bank account balances.",
  ]);
  rows.push([]);

  rows.push(["Monthly summary"]);
  rows.push([
    "Month",
    "Opening (JMD)",
    "Cash in (JMD)",
    "Cash out (JMD)",
    "Net movement (JMD)",
    "Closing (JMD)",
  ]);
  for (const m of monthly) {
    rows.push([
      m.monthKey,
      round2(m.openingBalanceJmd),
      round2(m.totalInJmd),
      round2(m.totalOutJmd),
      round2(m.netJmd),
      round2(m.closingBalanceJmd),
    ]);
  }
  rows.push([]);

  rows.push(["Cash in — detail (customer payments)"]);
  rows.push(["Month", "Date", "Invoice", "Invoice type", "Quote ref", "Method", "Reference", "Amount (JMD)"]);
  for (const m of monthly) {
    if (m.entries.length === 0) {
      rows.push([m.monthKey, "", "", "", "", "", "", 0]);
      continue;
    }
    for (const e of m.entries) {
      rows.push([
        m.monthKey,
        e.paidAtIso,
        e.invoiceNumber,
        e.invoiceType,
        e.quoteRef,
        e.method,
        e.reference,
        round2(e.amountJmd),
      ]);
    }
    rows.push([`${m.monthKey} total`, "", "", "", "", "", "", round2(m.totalInJmd)]);
  }
  rows.push([]);

  rows.push(["Cash out — detail (costs and expenses paid)"]);
  rows.push(["Month", "Date paid", "Type", "Category", "Party", "Description", "Reference", "Amount (JMD)"]);
  for (const m of monthly) {
    if (m.outEntries.length === 0) {
      rows.push([m.monthKey, "", "", "", "", "", "", 0]);
      continue;
    }
    for (const e of m.outEntries) {
      rows.push([
        m.monthKey,
        e.paidAtIso,
        CASH_OUT_KIND_LABELS[e.kind],
        e.categoryLabel,
        e.party,
        e.description,
        e.reference,
        round2(e.amountJmd),
      ]);
    }
    rows.push([`${m.monthKey} total`, "", "", "", "", "", "", round2(m.totalOutJmd)]);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Income statement
// ---------------------------------------------------------------------------

function statementColumnCells(c: IncomeStatementColumn): CsvCell[] {
  return [
    c.label,
    round2(c.revenueJmd),
    round2(c.costOfSalesJmd),
    round2(c.grossProfitJmd),
    round1(c.grossMarginPct),
    round2(c.operatingExpensesJmd),
    round2(c.netProfitJmd),
    round1(c.netMarginPct),
  ];
}

/**
 * The restructured P&L as a real income statement. The basis is stated in
 * the title, restated in full underneath, and repeated in every amount
 * column header — a figure in this file cannot be read without its basis.
 */
export function incomeStatementToCsvRows(statement: IncomeStatement): CsvCell[][] {
  const basis: ReportBasis = statement.basis;
  const suffix = REPORT_BASIS_SUFFIX[basis];
  const rows: CsvCell[][] = titleBlock(
    `Veridan — Income statement (${REPORT_BASIS_LABELS[basis]} basis)`,
    statement.range,
  );
  rows.push([REPORT_BASIS_DESCRIPTIONS[basis]]);
  rows.push([]);

  rows.push(["Statement"]);
  rows.push(["Line", `Amount (JMD, ${suffix})`]);
  rows.push(["Revenue", round2(statement.total.revenueJmd)]);
  rows.push(["Less: Cost of sales", round2(statement.total.costOfSalesJmd)]);
  rows.push(["Gross profit", round2(statement.total.grossProfitJmd)]);
  rows.push(["Gross margin (%)", round1(statement.total.grossMarginPct)]);
  rows.push(["Less: Operating expenses", round2(statement.total.operatingExpensesJmd)]);
  rows.push(["Net profit", round2(statement.total.netProfitJmd)]);
  rows.push(["Net margin (%)", round1(statement.total.netMarginPct)]);
  rows.push([]);

  const monthHeader: CsvCell[] = [
    "Period",
    `Revenue (JMD, ${suffix})`,
    `Cost of sales (JMD, ${suffix})`,
    `Gross profit (JMD, ${suffix})`,
    "Gross margin (%)",
    `Operating expenses (JMD, ${suffix})`,
    `Net profit (JMD, ${suffix})`,
    "Net margin (%)",
  ];
  rows.push(["By month"]);
  rows.push(monthHeader);
  for (const m of statement.months) rows.push(statementColumnCells(m));
  rows.push(statementColumnCells(statement.total));
  rows.push([]);

  rows.push(["Cost of sales by category"]);
  rows.push(["Category", `Amount (JMD, ${suffix})`]);
  for (const [category, amount] of statement.costOfSalesByCategory) {
    rows.push([ACTUAL_COST_CATEGORY_LABELS[category], round2(amount)]);
  }
  rows.push([]);

  rows.push(["Operating expenses by category"]);
  rows.push(["Category", "Key", `Amount (JMD, ${suffix})`]);
  for (const cat of statement.operatingExpensesByCategory) {
    rows.push([cat.categoryLabel, cat.categoryName, round2(cat.amountJmd)]);
  }
  rows.push([]);

  // Gross profit only — operating expenses are deliberately not allocated to
  // orders (see lib/reports/incomeStatement.ts's header), so this section
  // must never be mistaken for per-order net profit.
  rows.push(["Gross profit by order (operating expenses are NOT allocated to orders)"]);
  rows.push([
    "Quote ref",
    `Revenue (JMD, ${suffix})`,
    `Cost of sales (JMD, ${suffix})`,
    ...categoryHeaders(),
    `Gross profit (JMD, ${suffix})`,
    "Gross margin (%)",
    "Unconverted cost (USD)",
  ]);
  for (const o of statement.grossProfitByOrder) {
    rows.push([
      o.quoteRef,
      round2(o.revenueJmd),
      round2(o.costJmd),
      ...categoryCells(o.byCategory),
      round2(o.grossProfitJmd),
      round1(o.marginPct),
      round2(o.unconvertedCostUsd),
    ]);
  }

  if (statement.unconvertedCostOfSalesUsd > 0 || statement.unconvertedOperatingExpensesUsd > 0) {
    rows.push([]);
    rows.push(["Excluded from every figure above (no FX rate available)"]);
    rows.push(["Cost of sales (USD)", round2(statement.unconvertedCostOfSalesUsd)]);
    rows.push(["Operating expenses (USD)", round2(statement.unconvertedOperatingExpensesUsd)]);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Transaction detail (the accountant's ledger)
// ---------------------------------------------------------------------------

export const TRANSACTION_CSV_HEADERS: string[] = [
  "Date",
  "Type",
  "Reference",
  "Party",
  "Category",
  "Description",
  "Amount JMD (as recorded)",
  "Amount USD (as recorded)",
  "Amount JMD (for totalling)",
  "FX basis",
  "Date incurred",
  "Date paid",
  "Paid?",
];

export function transactionLedgerToCsvRows(ledger: TransactionLedger): CsvCell[][] {
  const rows: CsvCell[][] = titleBlock("Veridan — Transaction detail (general ledger)", ledger.range);
  rows.push([
    "Every recorded financial transaction in the period, chronologically. Amounts are shown exactly as recorded; the 'for totalling' column is the single-currency figure and the 'FX basis' column states how it was arrived at.",
  ]);
  rows.push([
    "Both dates travel on every row so this listing can be re-cut on either an accrual (date incurred) or a cash (date paid) basis. A blank 'Date paid' means the item is still unpaid.",
  ]);
  rows.push([]);
  rows.push(TRANSACTION_CSV_HEADERS);

  for (const r of ledger.rows) {
    rows.push([
      r.dateIso,
      TRANSACTION_TYPE_LABELS[r.type],
      r.reference,
      r.party,
      r.category,
      r.description,
      round2(r.amountJmd),
      round2(r.amountUsd),
      round2(r.resolvedJmd),
      TRANSACTION_FX_BASIS_LABELS[r.fxBasis],
      r.incurredDateIso,
      r.paidDateIso,
      r.paidDateIso ? "yes" : "no",
    ]);
  }

  rows.push([]);
  rows.push(["Totals"]);
  rows.push(["Money in (JMD)", round2(ledger.totalInJmd)]);
  rows.push(["Money out (JMD)", round2(ledger.totalOutJmd)]);
  rows.push(["Net (JMD)", round2(ledger.netJmd)]);
  if (ledger.unresolvedRowCount > 0) {
    rows.push([
      `Rows excluded from the totals (no FX rate available): ${ledger.unresolvedRowCount}`,
      round2(ledger.unresolvedUsd),
    ]);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Margin audit
// ---------------------------------------------------------------------------

export function marginAuditToCsvRows(report: MarginAuditReport, range: ReportDateRange): CsvCell[][] {
  const rows: CsvCell[][] = titleBlock("Veridan — Margin audit (quoted vs. actual vs. realized)", range);

  // ---- Summary ----
  rows.push(["Summary"]);
  rows.push(["Orders", report.rollup.orderCount]);
  rows.push(["Floor-drift flagged", report.rollup.flaggedCount]);
  rows.push(["Total quoted landed (USD)", round2(report.rollup.totalQuotedLandedUsd)]);
  rows.push(["Total actual cost (USD)", round2(report.rollup.totalActualCostUsd)]);
  rows.push(["Total cost variance (USD)", round2(report.rollup.totalCostVarianceUsd)]);
  rows.push(["Total payments received (JMD)", round2(report.rollup.totalPaymentsReceivedJmd)]);
  rows.push(["Portfolio realized margin (%)", round1(report.rollup.realizedMarginPct)]);
  rows.push([]);

  // ---- Per-order ----
  rows.push(["Per order"]);
  rows.push([
    "Flagged",
    "Quote ref",
    "Order status",
    "Quoted landed (USD)",
    "Quoted margin (%)",
    "Actual cost (USD)",
    "Cost variance (USD)",
    "Payments received (JMD)",
    "Realized cost (JMD)",
    "Realized margin (%)",
    "Projected-realized margin (%)",
    "Margin floor (%)",
    "Floor-check margin (%)",
    "Complete",
    "Note",
  ]);
  for (const r of report.rows) {
    rows.push([
      r.floorDrift ? "FLAG" : "",
      r.quoteRef,
      r.orderStatus,
      round2(r.quotedLandedUsd),
      round1(r.quotedMarginPct),
      round2(r.actualCostUsd),
      round2(r.totalCostVarianceUsd),
      round2(r.paymentsReceivedJmd),
      round2(r.realizedCostJmd),
      round1(r.realizedMarginPct),
      round1(r.projectedRealizedMarginPct),
      round1(r.marginFloorPct),
      round1(r.marginForFloorCheckPct),
      r.isComplete ? "yes" : "no",
      r.completenessNote,
    ]);
  }
  rows.push([]);

  // ---- Category variances (rollup) ----
  rows.push(["Cost variance by category (USD, all orders)"]);
  rows.push(["Category", "Quoted (USD)", "Actual (USD)", "Variance (USD)"]);
  for (const c of report.rollup.categories) {
    rows.push([
      VARIANCE_CATEGORY_LABELS[c.category],
      round2(c.quotedUsd),
      round2(c.actualUsd),
      round2(c.varianceUsd),
    ]);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Orders + actuals raw
// ---------------------------------------------------------------------------

export function ordersRawToCsvRows(data: OrdersRawRow[], range: ReportDateRange): CsvCell[][] {
  const rows: CsvCell[][] = titleBlock("Veridan — Orders & actual costs (raw)", range);
  rows.push(["Quote ref", "Order status", "Category", "Description", "Supplier", "Incurred date", "Amount (USD)", "Amount (JMD)"]);
  for (const r of data) {
    rows.push([
      r.quoteRef,
      r.orderStatus,
      r.category,
      r.description,
      r.supplierName,
      r.incurredDateIso,
      round2(r.amountUsd),
      round2(r.amountJmd),
    ]);
  }
  return rows;
}

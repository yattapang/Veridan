/**
 * Report → CSV-row serializers (Task 56) — PURE, no I/O. Each returns a
 * matrix of cells for lib/reports/csv.ts's buildCsvDocument. Amounts are
 * emitted as raw 2-dp numbers (no currency symbols, no thousands separators)
 * so the accountant's spreadsheet re-parses every value as a number; the
 * column HEADER states the currency instead. A leading title/date-range block
 * makes each export self-describing when opened months later.
 */

import type { CashFlowMonthRow } from "./cashflow";
import type { MarginAuditReport } from "./marginAudit";
import { VARIANCE_CATEGORY_LABELS } from "./marginAudit";
import type { ReportDateRange } from "./period";
import type { PnlMonthRow, PnlOrderRow } from "./pnl";
import type { OrdersRawRow } from "./load";
import type { CsvCell } from "./csv";

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
// P&L
// ---------------------------------------------------------------------------

export function pnlToCsvRows(monthly: PnlMonthRow[], byOrder: PnlOrderRow[], range: ReportDateRange): CsvCell[][] {
  const rows: CsvCell[][] = titleBlock("Veridan — Profit & Loss (cash basis)", range);

  rows.push(["By month"]);
  rows.push(["Month", "Revenue (JMD)", "Cost (JMD)", "Gross profit (JMD)", "Margin (%)", "Unconverted cost (USD)"]);
  for (const m of monthly) {
    rows.push([
      m.monthKey,
      round2(m.revenueJmd),
      round2(m.costJmd),
      round2(m.grossProfitJmd),
      round1(m.marginPct),
      round2(m.unconvertedCostUsd),
    ]);
  }

  rows.push([]);
  rows.push(["By order"]);
  rows.push(["Quote ref", "Revenue (JMD)", "Cost (JMD)", "Gross profit (JMD)", "Margin (%)", "Unconverted cost (USD)"]);
  for (const o of byOrder) {
    rows.push([
      o.quoteRef,
      round2(o.revenueJmd),
      round2(o.costJmd),
      round2(o.grossProfitJmd),
      round1(o.marginPct),
      round2(o.unconvertedCostUsd),
    ]);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

export function cashFlowToCsvRows(monthly: CashFlowMonthRow[], range: ReportDateRange): CsvCell[][] {
  const rows: CsvCell[][] = titleBlock("Veridan — Cash flow (payments received)", range);
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

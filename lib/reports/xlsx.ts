/**
 * Excel workbook builders (Task 56; extended 2026-08-07). Two reports get a
 * real .xlsx rather than only a CSV, because both are worked ON rather than
 * merely read:
 *   · the MARGIN AUDIT — the founder's analytical report, one worksheet per
 *     section (Summary, Per order, Category variance);
 *   · the TRANSACTION DETAIL ledger — the accountant's working file, with an
 *     autofilter, a frozen header, per-type subtotals, and an "About" sheet
 *     documenting every column and the per-row FX vocabulary.
 * Both carry currency/percent number formats so the figures are usable in a
 * pivot without re-typing. exceljs runs server-side only, inside the Node
 * runtime route handlers, never bundled into the client.
 *
 * Same data discipline as everywhere in lib/reports/*: these take an
 * already-computed, pure report object and only format it — no fetching, no
 * arithmetic of their own beyond presentational subtotals, and no quote
 * projections leaking into a total beyond the margin audit's explicit,
 * labeled "Quoted" columns.
 */

import ExcelJS from "exceljs";
import type { MarginAuditReport } from "./marginAudit";
import { VARIANCE_CATEGORY_LABELS } from "./marginAudit";
import { ORDER_STATUS_LABELS } from "../orders/format";
import type { ReportDateRange } from "./period";
import {
  TRANSACTION_FX_BASIS_LABELS,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPES,
  type TransactionLedger,
} from "./transactions";

const USD_FMT = '"$"#,##0.00';
const JMD_FMT = '"J$"#,##0.00';
const PCT_FMT = "0.0";

function round(n: number | null | undefined, dp: number): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export async function buildMarginAuditWorkbook(
  report: MarginAuditReport,
  range: ReportDateRange,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Veridan Limited";
  wb.created = new Date();

  // ---- Sheet 1: Summary ----
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 34 },
    { header: "Value", key: "value", width: 20 },
  ];
  summary.getRow(1).font = { bold: true };
  const summaryRows: [string, number | null, string?][] = [
    ["Period from", null],
    ["Period to", null],
    ["Orders", report.rollup.orderCount],
    ["Floor-drift flagged", report.rollup.flaggedCount],
    ["Total quoted landed (USD)", round(report.rollup.totalQuotedLandedUsd, 2), USD_FMT],
    ["Total actual cost (USD)", round(report.rollup.totalActualCostUsd, 2), USD_FMT],
    ["Total cost variance (USD)", round(report.rollup.totalCostVarianceUsd, 2), USD_FMT],
    ["Total payments received (JMD)", round(report.rollup.totalPaymentsReceivedJmd, 2), JMD_FMT],
    ["Portfolio realized margin (%)", round(report.rollup.realizedMarginPct, 1), PCT_FMT],
  ];
  // Period rows carry text values; the rest are numeric.
  summary.addRow({ metric: "Period from", value: range.startIso });
  summary.addRow({ metric: "Period to", value: range.endIso });
  for (const [metric, value, fmt] of summaryRows.slice(2)) {
    const row = summary.addRow({ metric, value });
    if (fmt && value != null) row.getCell("value").numFmt = fmt;
  }

  // ---- Sheet 2: Per order ----
  const orders = wb.addWorksheet("Per order");
  orders.columns = [
    { header: "Flagged", key: "flagged", width: 9 },
    { header: "Quote ref", key: "quoteRef", width: 16 },
    { header: "Order status", key: "status", width: 15 },
    { header: "Quoted landed (USD)", key: "quotedLanded", width: 18 },
    { header: "Quoted margin (%)", key: "quotedMargin", width: 16 },
    { header: "Actual cost (USD)", key: "actualCost", width: 16 },
    { header: "Cost variance (USD)", key: "costVariance", width: 17 },
    { header: "Payments received (JMD)", key: "payments", width: 20 },
    { header: "Realized cost (JMD)", key: "realizedCost", width: 18 },
    { header: "Realized margin (%)", key: "realizedMargin", width: 17 },
    { header: "Projected-realized margin (%)", key: "projMargin", width: 24 },
    { header: "Margin floor (%)", key: "floor", width: 14 },
    { header: "Floor-check margin (%)", key: "floorCheck", width: 19 },
    { header: "Complete", key: "complete", width: 10 },
    { header: "Note", key: "note", width: 50 },
  ];
  orders.getRow(1).font = { bold: true };
  for (const r of report.rows) {
    const row = orders.addRow({
      flagged: r.floorDrift ? "FLAG" : "",
      quoteRef: r.quoteRef,
      status: ORDER_STATUS_LABELS[r.orderStatus],
      quotedLanded: round(r.quotedLandedUsd, 2),
      quotedMargin: round(r.quotedMarginPct, 1),
      actualCost: round(r.actualCostUsd, 2),
      costVariance: round(r.totalCostVarianceUsd, 2),
      payments: round(r.paymentsReceivedJmd, 2),
      realizedCost: round(r.realizedCostJmd, 2),
      realizedMargin: round(r.realizedMarginPct, 1),
      projMargin: round(r.projectedRealizedMarginPct, 1),
      floor: round(r.marginFloorPct, 1),
      floorCheck: round(r.marginForFloorCheckPct, 1),
      complete: r.isComplete ? "yes" : "no",
      note: r.completenessNote ?? "",
    });
    row.getCell("quotedLanded").numFmt = USD_FMT;
    row.getCell("actualCost").numFmt = USD_FMT;
    row.getCell("costVariance").numFmt = USD_FMT;
    row.getCell("payments").numFmt = JMD_FMT;
    row.getCell("realizedCost").numFmt = JMD_FMT;
    row.getCell("quotedMargin").numFmt = PCT_FMT;
    row.getCell("realizedMargin").numFmt = PCT_FMT;
    row.getCell("projMargin").numFmt = PCT_FMT;
    row.getCell("floor").numFmt = PCT_FMT;
    row.getCell("floorCheck").numFmt = PCT_FMT;
    if (r.floorDrift) {
      row.getCell("flagged").font = { bold: true, color: { argb: "FFB91C1C" } };
    }
  }

  // ---- Sheet 3: Category variance ----
  const cats = wb.addWorksheet("Category variance");
  cats.columns = [
    { header: "Category", key: "category", width: 20 },
    { header: "Quoted (USD)", key: "quoted", width: 16 },
    { header: "Actual (USD)", key: "actual", width: 16 },
    { header: "Variance (USD)", key: "variance", width: 16 },
  ];
  cats.getRow(1).font = { bold: true };
  for (const c of report.rollup.categories) {
    const row = cats.addRow({
      category: VARIANCE_CATEGORY_LABELS[c.category],
      quoted: round(c.quotedUsd, 2),
      actual: round(c.actualUsd, 2),
      variance: round(c.varianceUsd, 2),
    });
    row.getCell("quoted").numFmt = USD_FMT;
    row.getCell("actual").numFmt = USD_FMT;
    row.getCell("variance").numFmt = USD_FMT;
  }

  return wb.xlsx.writeBuffer();
}

/**
 * Transaction detail as a real workbook — THE file the accountant opens.
 *
 * Three sheets:
 *   1. "Transactions" — the full chronological ledger, one row per recorded
 *      event, with an autofilter and a frozen header so it can be sorted and
 *      sliced in place.
 *   2. "By type"      — money-in / money-out subtotals per transaction type.
 *   3. "About"        — what the period is, what each column means, and the
 *      per-row FX-basis vocabulary, so the file is still self-explanatory
 *      when it is opened months later by someone who was not in the room.
 *
 * Same discipline as buildMarginAuditWorkbook: this takes an
 * already-computed, pure `TransactionLedger` and only formats it. No
 * fetching, no arithmetic beyond the subtotals the ledger already exposes.
 */
export async function buildTransactionLedgerWorkbook(
  ledger: TransactionLedger,
  range: ReportDateRange,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Veridan Limited";
  wb.created = new Date();

  // ---- Sheet 1: Transactions ----
  const sheet = wb.addWorksheet("Transactions");
  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "type", width: 18 },
    { header: "Reference", key: "reference", width: 24 },
    { header: "Party", key: "party", width: 26 },
    { header: "Category", key: "category", width: 20 },
    { header: "Description", key: "description", width: 44 },
    { header: "Amount JMD (as recorded)", key: "amountJmd", width: 22 },
    { header: "Amount USD (as recorded)", key: "amountUsd", width: 22 },
    { header: "Amount JMD (for totalling)", key: "resolvedJmd", width: 23 },
    { header: "FX basis", key: "fxBasis", width: 38 },
    { header: "Date incurred", key: "incurred", width: 14 },
    { header: "Date paid", key: "paid", width: 12 },
    { header: "Paid?", key: "isPaid", width: 8 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of ledger.rows) {
    const row = sheet.addRow({
      date: r.dateIso,
      type: TRANSACTION_TYPE_LABELS[r.type],
      reference: r.reference ?? "",
      party: r.party ?? "",
      category: r.category,
      description: r.description ?? "",
      amountJmd: round(r.amountJmd, 2),
      amountUsd: round(r.amountUsd, 2),
      resolvedJmd: round(r.resolvedJmd, 2),
      fxBasis: TRANSACTION_FX_BASIS_LABELS[r.fxBasis],
      incurred: r.incurredDateIso ?? "",
      paid: r.paidDateIso ?? "",
      isPaid: r.paidDateIso ? "yes" : "no",
    });
    row.getCell("amountJmd").numFmt = JMD_FMT;
    row.getCell("amountUsd").numFmt = USD_FMT;
    row.getCell("resolvedJmd").numFmt = JMD_FMT;
    // An unresolved row has no figure in the totals; flagging it in place
    // means the accountant sees the gap on the row itself rather than only
    // in a footnote they may not scroll to.
    if (r.fxBasis === "unconverted") {
      row.getCell("fxBasis").font = { bold: true, color: { argb: "FFB91C1C" } };
    }
  }

  if (ledger.rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }

  // ---- Sheet 2: By type ----
  const summary = wb.addWorksheet("By type");
  summary.columns = [
    { header: "Type", key: "type", width: 22 },
    { header: "Direction", key: "direction", width: 12 },
    { header: "Rows", key: "count", width: 8 },
    { header: "Total (JMD)", key: "total", width: 18 },
  ];
  summary.getRow(1).font = { bold: true };
  for (const type of TRANSACTION_TYPES) {
    const rowsOfType = ledger.rows.filter((r) => r.type === type);
    const total = rowsOfType.reduce((s, r) => s + (r.resolvedJmd ?? 0), 0);
    const row = summary.addRow({
      type: TRANSACTION_TYPE_LABELS[type],
      direction: type === "customer_payment" ? "In" : "Out",
      count: rowsOfType.length,
      total: round(total, 2),
    });
    row.getCell("total").numFmt = JMD_FMT;
  }
  summary.addRow({});
  const totalsRows: [string, string, number][] = [
    ["Money in", "In", ledger.totalInJmd],
    ["Money out", "Out", ledger.totalOutJmd],
    ["Net", "", ledger.netJmd],
  ];
  for (const [label, direction, value] of totalsRows) {
    const row = summary.addRow({ type: label, direction, total: round(value, 2) });
    row.font = { bold: true };
    row.getCell("total").numFmt = JMD_FMT;
  }
  if (ledger.unresolvedRowCount > 0) {
    summary.addRow({});
    const row = summary.addRow({
      type: "Excluded from totals (no FX rate)",
      count: ledger.unresolvedRowCount,
      total: null,
    });
    row.font = { color: { argb: "FFB91C1C" } };
    const usdRow = summary.addRow({ type: "…their USD face value", total: round(ledger.unresolvedUsd, 2) });
    usdRow.getCell("total").numFmt = USD_FMT;
  }

  // ---- Sheet 3: About ----
  const about = wb.addWorksheet("About");
  about.columns = [
    { header: "Item", key: "item", width: 30 },
    { header: "Detail", key: "detail", width: 96 },
  ];
  about.getRow(1).font = { bold: true };
  const aboutRows: [string, string][] = [
    ["Report", "Veridan — Transaction detail (general ledger)"],
    ["Period from", range.startIso],
    ["Period to", range.endIso],
    ["Generated", new Date().toISOString()],
    [
      "What this is",
      "Every financial transaction Veridan recorded in the period, in one chronological listing: customer payments received, cost of sales, and operating expenses. It is not a double-entry journal — there are no debits, credits, or a trial balance.",
    ],
    [
      "Date column",
      "Each row's primary date: a customer payment's payment date, and a cost's or expense's incurred date. Fixed rather than basis-dependent, because this listing is the raw record both the accrual and cash statements are derived from.",
    ],
    [
      "Date incurred / Date paid",
      "Both dates travel on every row so this file can be re-cut on either basis. A blank 'Date paid' means the item is still unpaid and is therefore absent from every cash-basis figure elsewhere.",
    ],
    [
      "Amount as recorded",
      "Exactly the JMD and/or USD amount that was entered. Never derived, never overwritten.",
    ],
    [
      "Amount for totalling",
      "A single-currency JMD figure so the column can be summed. The 'FX basis' column states per row how it was arrived at.",
    ],
    ["FX basis — " + TRANSACTION_FX_BASIS_LABELS.native, "The row was recorded in JMD; no conversion was applied."],
    [
      "FX basis — " + TRANSACTION_FX_BASIS_LABELS.order_rate,
      "A USD-only cost of sales, converted at its own order's quote-locked FX rate. That rate is frozen, so this figure is stable over time.",
    ],
    [
      "FX basis — " + TRANSACTION_FX_BASIS_LABELS.current_rate,
      "A USD-only operating expense. Expenses are not linked to an order, so there is no locked rate — this is converted at the CURRENT business-parameter rate at the moment this file was generated, and can differ if the file is regenerated later.",
    ],
    [
      "FX basis — " + TRANSACTION_FX_BASIS_LABELS.unconverted,
      "No rate was available, so the row is excluded from the totals rather than counted as zero. Flagged in red on the Transactions sheet.",
    ],
  ];
  for (const [item, detail] of aboutRows) {
    const row = about.addRow({ item, detail });
    row.getCell("detail").alignment = { wrapText: true, vertical: "top" };
  }

  return wb.xlsx.writeBuffer();
}

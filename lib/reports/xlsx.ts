/**
 * Margin-audit Excel workbook builder (Task 56). The founder's analytical
 * report gets a real .xlsx — one worksheet per report section (Summary,
 * Per order, Category variance) with currency/percent number formats so the
 * figures are usable in a pivot without re-typing. exceljs is the one new
 * dependency the Task 56 brief allows; it runs server-side only, inside the
 * Node runtime route handler, never bundled into the client.
 *
 * Same data discipline as everywhere in lib/reports/*: this takes an
 * already-computed MarginAuditReport (pure, from buildMarginAudit) and only
 * formats it — no fetching, no quote projections leaking into a total beyond
 * the audit's explicit, labeled "Quoted" columns.
 */

import ExcelJS from "exceljs";
import type { MarginAuditReport } from "./marginAudit";
import { VARIANCE_CATEGORY_LABELS } from "./marginAudit";
import { ORDER_STATUS_LABELS } from "../orders/format";
import type { ReportDateRange } from "./period";

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

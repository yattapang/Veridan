import { describe, expect, it } from "vitest";
import {
  computePnlByMonth,
  computePnlByOrder,
  costAmountJmd,
  mergeCategoryTotals,
  type PnlCostInput,
  type PnlMonthRow,
  type PnlOrderRow,
  type PnlPaymentInput,
} from "./pnl";
import type { ReportDateRange } from "./period";

/** Sums a row's `byCategory` map — used to assert it always reconciles to `costJmd`. */
function sumByCategory(row: { byCategory: Partial<Record<string, number>> }): number {
  return Object.values(row.byCategory).reduce((s: number, v) => s + (v ?? 0), 0);
}

const RANGE: ReportDateRange = { startIso: "2026-01-01", endIso: "2026-12-31" };
const RATE = 166.86; // JMD per 1 USD

describe("costAmountJmd", () => {
  it("uses the row's own JMD value when present, ignoring any USD sibling value", () => {
    const cost: PnlCostInput = {
      orderId: "o1",
      amountUsd: 999,
      amountJmd: 5000,
      incurredDateIso: "2026-03-01",
      category: "freight",
    };
    expect(costAmountJmd(cost, { o1: RATE })).toBe(5000);
  });

  it("converts a USD-only row at the order's locked rate", () => {
    const cost: PnlCostInput = {
      orderId: "o1",
      amountUsd: 100,
      amountJmd: null,
      incurredDateIso: "2026-03-01",
      category: "freight",
    };
    expect(costAmountJmd(cost, { o1: RATE })).toBeCloseTo(16686, 2);
  });

  it("returns null when a USD-only row's order has no known rate", () => {
    const cost: PnlCostInput = {
      orderId: "unknown-order",
      amountUsd: 100,
      amountJmd: null,
      incurredDateIso: "2026-03-01",
      category: "freight",
    };
    expect(costAmountJmd(cost, { o1: RATE })).toBeNull();
  });
});

describe("computePnlByMonth", () => {
  it("returns a zero-filled row for every month in range when there is no data at all", () => {
    const rows = computePnlByMonth([], [], {}, { startIso: "2026-01-01", endIso: "2026-03-31" });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.revenueJmd).toBe(0);
      expect(row.costJmd).toBe(0);
      expect(row.grossProfitJmd).toBe(0);
      expect(row.marginPct).toBeNull();
    }
  });

  it("sums same-month payments and costs, and computes margin %", () => {
    const payments: PnlPaymentInput[] = [
      { amountJmd: 100000, paidAtIso: "2026-03-05", orderId: "o1", quoteRef: "VQ-2026-001", invoiceNumber: "VI-2026-001" },
      { amountJmd: 50000, paidAtIso: "2026-03-20", orderId: "o1", quoteRef: "VQ-2026-001", invoiceNumber: "VI-2026-002" },
    ];
    const costs: PnlCostInput[] = [
      { orderId: "o1", amountUsd: null, amountJmd: 60000, incurredDateIso: "2026-03-10", category: "hardware" },
    ];
    const rows = computePnlByMonth(payments, costs, {}, RANGE);
    const march = rows.find((r) => r.monthKey === "2026-03")!;
    expect(march.revenueJmd).toBe(150000);
    expect(march.costJmd).toBe(60000);
    expect(march.grossProfitJmd).toBe(90000);
    expect(march.marginPct).toBeCloseTo(60, 5);
  });

  it("handles multi-currency actuals within the same month, converting USD-only rows", () => {
    const costs: PnlCostInput[] = [
      { orderId: "o1", amountUsd: null, amountJmd: 10000, incurredDateIso: "2026-05-01", category: "hardware" },
      { orderId: "o1", amountUsd: 100, amountJmd: null, incurredDateIso: "2026-05-15", category: "freight" },
    ];
    const rows = computePnlByMonth([], costs, { o1: RATE }, RANGE);
    const may = rows.find((r) => r.monthKey === "2026-05")!;
    expect(may.costJmd).toBeCloseTo(10000 + 16686, 2);
    expect(may.unconvertedCostUsd).toBe(0);
  });

  it("tracks unconverted USD-only cost separately when the order's rate is unknown, rather than silently dropping it", () => {
    const costs: PnlCostInput[] = [
      { orderId: "unknown", amountUsd: 200, amountJmd: null, incurredDateIso: "2026-06-01", category: "duty" },
    ];
    const rows = computePnlByMonth([], costs, {}, RANGE);
    const june = rows.find((r) => r.monthKey === "2026-06")!;
    expect(june.costJmd).toBe(0);
    expect(june.unconvertedCostUsd).toBe(200);
  });

  it("respects month boundaries at year end (Dec 31 vs Jan 1, date-only — no timezone shift)", () => {
    const payments: PnlPaymentInput[] = [
      { amountJmd: 1000, paidAtIso: "2026-12-31", orderId: "o1", quoteRef: "VQ", invoiceNumber: "VI-1" },
      { amountJmd: 2000, paidAtIso: "2027-01-01", orderId: "o1", quoteRef: "VQ", invoiceNumber: "VI-2" },
    ];
    const range: ReportDateRange = { startIso: "2026-12-01", endIso: "2027-01-31" };
    const rows = computePnlByMonth(payments, [], {}, range);
    expect(rows.find((r) => r.monthKey === "2026-12")!.revenueJmd).toBe(1000);
    expect(rows.find((r) => r.monthKey === "2027-01")!.revenueJmd).toBe(2000);
  });

  it("excludes payments/costs outside the given range", () => {
    const payments: PnlPaymentInput[] = [
      { amountJmd: 5000, paidAtIso: "2025-12-31", orderId: "o1", quoteRef: "VQ", invoiceNumber: "VI-1" },
    ];
    const rows = computePnlByMonth(payments, [], {}, RANGE);
    expect(rows.reduce((s, r) => s + r.revenueJmd, 0)).toBe(0);
  });

  it("breaks JMD cost down by category within a month, and across different months", () => {
    const costs: PnlCostInput[] = [
      { orderId: "o1", amountUsd: null, amountJmd: 10000, incurredDateIso: "2026-03-01", category: "hardware" },
      { orderId: "o1", amountUsd: null, amountJmd: 4000, incurredDateIso: "2026-03-15", category: "freight" },
      { orderId: "o1", amountUsd: null, amountJmd: 2500, incurredDateIso: "2026-03-20", category: "hardware" },
      { orderId: "o1", amountUsd: null, amountJmd: 7000, incurredDateIso: "2026-04-01", category: "duty" },
    ];
    const rows = computePnlByMonth([], costs, {}, RANGE);
    const march = rows.find((r) => r.monthKey === "2026-03")!;
    const april = rows.find((r) => r.monthKey === "2026-04")!;

    expect(march.byCategory).toEqual({ hardware: 12500, freight: 4000 });
    expect(april.byCategory).toEqual({ duty: 7000 });
  });

  it("combines a USD-only row with a JMD row in the same category, converting the USD side", () => {
    const costs: PnlCostInput[] = [
      { orderId: "o1", amountUsd: null, amountJmd: 10000, incurredDateIso: "2026-05-01", category: "insurance" },
      { orderId: "o1", amountUsd: 100, amountJmd: null, incurredDateIso: "2026-05-15", category: "insurance" },
    ];
    const rows = computePnlByMonth([], costs, { o1: RATE }, RANGE);
    const may = rows.find((r) => r.monthKey === "2026-05")!;
    expect(may.byCategory).toEqual({ insurance: 10000 + 16686 });
    expect(may.byCategory.insurance).toBeCloseTo(26686, 2);
  });

  it("surfaces an unconvertible USD-only category cost separately rather than dropping it", () => {
    const costs: PnlCostInput[] = [
      { orderId: "o1", amountUsd: null, amountJmd: 5000, incurredDateIso: "2026-06-01", category: "brokerage" },
      { orderId: "unknown-order", amountUsd: 300, amountJmd: null, incurredDateIso: "2026-06-10", category: "brokerage" },
      { orderId: "unknown-order", amountUsd: 50, amountJmd: null, incurredDateIso: "2026-06-12", category: "duty" },
    ];
    const rows = computePnlByMonth([], costs, {}, RANGE);
    const june = rows.find((r) => r.monthKey === "2026-06")!;

    // Only the converted brokerage row counts toward byCategory/costJmd.
    expect(june.byCategory).toEqual({ brokerage: 5000 });
    expect(june.costJmd).toBe(5000);
    // The unconvertible rows are tracked per category instead of silently dropped.
    expect(june.unconvertedUsdByCategory).toEqual({ brokerage: 300, duty: 50 });
    expect(june.unconvertedCostUsd).toBe(350);
  });

  it("leaves byCategory absent (empty object) for a month with no cost data — not zero-filled per category", () => {
    const rows = computePnlByMonth([], [], {}, { startIso: "2026-01-01", endIso: "2026-02-28" });
    for (const row of rows) {
      expect(row.byCategory).toEqual({});
      expect(Object.keys(row.byCategory)).toHaveLength(0);
    }
  });

  it("guarantees the sum of category subtotals equals costJmd for every month (grand-total consistency)", () => {
    const costs: PnlCostInput[] = [
      { orderId: "o1", amountUsd: null, amountJmd: 10000, incurredDateIso: "2026-07-01", category: "hardware" },
      { orderId: "o1", amountUsd: 100, amountJmd: null, incurredDateIso: "2026-07-05", category: "freight" },
      { orderId: "o1", amountUsd: null, amountJmd: 3000, incurredDateIso: "2026-07-10", category: "other" },
      // unconvertible — must NOT be counted in costJmd or byCategory.
      { orderId: "unknown", amountUsd: 999, amountJmd: null, incurredDateIso: "2026-07-15", category: "delivery" },
    ];
    const rows = computePnlByMonth([], costs, { o1: RATE }, RANGE);
    for (const row of rows) {
      expect(sumByCategory(row)).toBeCloseTo(row.costJmd, 6);
    }
    const july = rows.find((r) => r.monthKey === "2026-07")!;
    expect(july.costJmd).toBeCloseTo(10000 + 16686 + 3000, 2);
  });
});

describe("computePnlByOrder", () => {
  it("returns an empty array for no data", () => {
    expect(computePnlByOrder([], [], {}, RANGE)).toEqual([]);
  });

  it("groups by order, excludes payments with no order yet, and sorts by revenue descending", () => {
    const payments: PnlPaymentInput[] = [
      { amountJmd: 50000, paidAtIso: "2026-02-01", orderId: "o1", quoteRef: "VQ-A", invoiceNumber: "VI-1" },
      { amountJmd: 200000, paidAtIso: "2026-02-01", orderId: "o2", quoteRef: "VQ-B", invoiceNumber: "VI-2" },
      { amountJmd: 99999, paidAtIso: "2026-02-01", orderId: null, quoteRef: "VQ-C", invoiceNumber: "VI-3" },
    ];
    const costs: PnlCostInput[] = [
      { orderId: "o1", amountUsd: null, amountJmd: 10000, incurredDateIso: "2026-02-05", category: "hardware" },
      { orderId: "o2", amountUsd: 100, amountJmd: null, incurredDateIso: "2026-02-05", category: "freight" },
    ];
    const rows = computePnlByOrder(payments, costs, { o2: RATE }, RANGE);

    expect(rows).toHaveLength(2);
    expect(rows[0].orderId).toBe("o2");
    expect(rows[0].revenueJmd).toBe(200000);
    expect(rows[0].costJmd).toBeCloseTo(16686, 2);
    expect(rows[0].marginPct).toBeCloseTo(((200000 - 16686) / 200000) * 100, 5);

    expect(rows[1].orderId).toBe("o1");
    expect(rows[1].revenueJmd).toBe(50000);
    expect(rows[1].costJmd).toBe(10000);
  });

  it("never derives a total from quote fields — quoteRef is carried only as a label", () => {
    const payments: PnlPaymentInput[] = [
      { amountJmd: 1000, paidAtIso: "2026-02-01", orderId: "o1", quoteRef: "VQ-A", invoiceNumber: "VI-1" },
    ];
    const rows = computePnlByOrder(payments, [], {}, RANGE);
    expect(rows[0].quoteRef).toBe("VQ-A");
    // quoteRef is a string, never summed — this test documents (not just asserts) that intent.
    expect(typeof rows[0].quoteRef).toBe("string");
  });

  it("breaks cost down by category per order, mixing USD and JMD rows within a category", () => {
    const payments: PnlPaymentInput[] = [
      { amountJmd: 200000, paidAtIso: "2026-02-01", orderId: "o1", quoteRef: "VQ-A", invoiceNumber: "VI-1" },
    ];
    const costs: PnlCostInput[] = [
      { orderId: "o1", amountUsd: null, amountJmd: 10000, incurredDateIso: "2026-02-05", category: "hardware" },
      { orderId: "o1", amountUsd: 100, amountJmd: null, incurredDateIso: "2026-02-06", category: "hardware" },
      { orderId: "o1", amountUsd: null, amountJmd: 2000, incurredDateIso: "2026-02-07", category: "port_handling" },
    ];
    const rows = computePnlByOrder(payments, costs, { o1: RATE }, RANGE);
    const order = rows[0];
    expect(order.byCategory.hardware).toBeCloseTo(10000 + 16686, 2);
    expect(order.byCategory.port_handling).toBe(2000);
    expect(Object.keys(order.byCategory).sort()).toEqual(["hardware", "port_handling"]);
  });

  it("tracks an unconvertible USD-only category cost per order without dropping it, and keeps grand-total consistency", () => {
    const payments: PnlPaymentInput[] = [
      { amountJmd: 50000, paidAtIso: "2026-02-01", orderId: "o1", quoteRef: "VQ-A", invoiceNumber: "VI-1" },
    ];
    const costs: PnlCostInput[] = [
      { orderId: "o1", amountUsd: null, amountJmd: 5000, incurredDateIso: "2026-02-05", category: "duty" },
      // o1 has no rate registered below, so this USD-only row is unconvertible.
      { orderId: "o1", amountUsd: 40, amountJmd: null, incurredDateIso: "2026-02-06", category: "duty" },
      { orderId: "o1", amountUsd: 15, amountJmd: null, incurredDateIso: "2026-02-07", category: "other" },
    ];
    const rows = computePnlByOrder(payments, costs, {}, RANGE);
    const order = rows[0];

    expect(order.byCategory).toEqual({ duty: 5000 });
    expect(order.unconvertedUsdByCategory).toEqual({ duty: 40, other: 15 });
    expect(order.unconvertedCostUsd).toBe(55);
    expect(sumByCategory(order)).toBeCloseTo(order.costJmd, 6);
  });
});

describe("mergeCategoryTotals", () => {
  it("merges category subtotals across many rows into one portfolio-level total per category", () => {
    const rows: Pick<PnlMonthRow, "byCategory">[] = [
      { byCategory: { hardware: 1000, freight: 200 } },
      { byCategory: { hardware: 500, duty: 75 } },
      { byCategory: {} },
    ];
    expect(mergeCategoryTotals(rows)).toEqual({ hardware: 1500, freight: 200, duty: 75 });
  });

  it("returns an empty object when every row has an empty byCategory", () => {
    const rows: Pick<PnlOrderRow, "byCategory">[] = [{ byCategory: {} }, { byCategory: {} }];
    expect(mergeCategoryTotals(rows)).toEqual({});
  });

  it("reconciles with the grand total: merging every month's byCategory sums to the portfolio costJmd", () => {
    const costs: PnlCostInput[] = [
      { orderId: "o1", amountUsd: null, amountJmd: 10000, incurredDateIso: "2026-01-10", category: "hardware" },
      { orderId: "o1", amountUsd: null, amountJmd: 4000, incurredDateIso: "2026-02-10", category: "freight" },
      { orderId: "o1", amountUsd: 100, amountJmd: null, incurredDateIso: "2026-03-10", category: "hardware" },
    ];
    const monthly = computePnlByMonth([], costs, { o1: RATE }, RANGE);
    const portfolioByCategory = mergeCategoryTotals(monthly);
    const totalFromCategories = Object.values(portfolioByCategory).reduce((s, v) => s + (v ?? 0), 0);
    const totalCostJmd = monthly.reduce((s, r) => s + r.costJmd, 0);
    expect(totalFromCategories).toBeCloseTo(totalCostJmd, 6);
  });
});

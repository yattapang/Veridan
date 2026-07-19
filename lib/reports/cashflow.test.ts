import { describe, expect, it } from "vitest";
import { computeCashFlowByMonth, totalCashInJmd, type CashInEntry } from "./cashflow";
import type { ReportDateRange } from "./period";

const RANGE: ReportDateRange = { startIso: "2026-01-01", endIso: "2026-12-31" };

function entry(overrides: Partial<CashInEntry>): CashInEntry {
  return {
    amountJmd: 1000,
    paidAtIso: "2026-01-01",
    invoiceNumber: "VI-2026-001",
    invoiceType: "deposit",
    quoteRef: "VQ-2026-001",
    method: null,
    reference: null,
    ...overrides,
  };
}

describe("computeCashFlowByMonth", () => {
  it("returns a zero-filled row for every month with no entries", () => {
    const rows = computeCashFlowByMonth([], { startIso: "2026-01-01", endIso: "2026-02-28" });
    expect(rows).toEqual([
      { monthKey: "2026-01", totalInJmd: 0, entries: [] },
      { monthKey: "2026-02", totalInJmd: 0, entries: [] },
    ]);
  });

  it("sums entries within a month and sorts them oldest-first", () => {
    const entries = [
      entry({ amountJmd: 500, paidAtIso: "2026-03-20", invoiceNumber: "VI-2" }),
      entry({ amountJmd: 300, paidAtIso: "2026-03-05", invoiceNumber: "VI-1" }),
    ];
    const rows = computeCashFlowByMonth(entries, RANGE);
    const march = rows.find((r) => r.monthKey === "2026-03")!;
    expect(march.totalInJmd).toBe(800);
    expect(march.entries.map((e) => e.invoiceNumber)).toEqual(["VI-1", "VI-2"]);
  });

  it("handles the Dec 31 / Jan 1 month boundary without a timezone shift (date-only bucketing)", () => {
    const entries = [
      entry({ amountJmd: 100, paidAtIso: "2026-12-31" }),
      entry({ amountJmd: 200, paidAtIso: "2027-01-01" }),
    ];
    const range: ReportDateRange = { startIso: "2026-12-01", endIso: "2027-01-31" };
    const rows = computeCashFlowByMonth(entries, range);
    expect(rows.find((r) => r.monthKey === "2026-12")!.totalInJmd).toBe(100);
    expect(rows.find((r) => r.monthKey === "2027-01")!.totalInJmd).toBe(200);
  });

  it("excludes entries outside the given range", () => {
    const entries = [entry({ amountJmd: 999, paidAtIso: "2025-06-01" })];
    const rows = computeCashFlowByMonth(entries, RANGE);
    expect(rows.reduce((s, r) => s + r.totalInJmd, 0)).toBe(0);
  });

  it("carries invoice/quote refs as labels without altering totals", () => {
    const entries = [entry({ amountJmd: 750, invoiceNumber: "VI-2026-042", quoteRef: "VQ-2026-042" })];
    const rows = computeCashFlowByMonth(entries, RANGE);
    const jan = rows.find((r) => r.monthKey === "2026-01")!;
    expect(jan.entries[0].invoiceNumber).toBe("VI-2026-042");
    expect(jan.entries[0].quoteRef).toBe("VQ-2026-042");
    expect(jan.totalInJmd).toBe(750);
  });
});

describe("totalCashInJmd", () => {
  it("sums zero for empty rows", () => {
    expect(totalCashInJmd([])).toBe(0);
  });

  it("sums across all monthly rows", () => {
    const rows = computeCashFlowByMonth(
      [entry({ amountJmd: 100, paidAtIso: "2026-01-01" }), entry({ amountJmd: 200, paidAtIso: "2026-02-01" })],
      { startIso: "2026-01-01", endIso: "2026-02-28" },
    );
    expect(totalCashInJmd(rows)).toBe(300);
  });
});

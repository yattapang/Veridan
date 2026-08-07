import { describe, expect, it } from "vitest";
import {
  computeCashFlowByMonth,
  netCashMovementJmd,
  totalCashInJmd,
  totalCashOutByKind,
  totalCashOutJmd,
  type CashInEntry,
  type CashOutEntry,
} from "./cashflow";
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

function outEntry(overrides: Partial<CashOutEntry>): CashOutEntry {
  return {
    amountJmd: 500,
    paidAtIso: "2026-01-01",
    kind: "operating_expense",
    categoryLabel: "Rent & Utilities",
    description: "Office rent",
    party: "Kingston Properties",
    reference: null,
    ...overrides,
  };
}

describe("computeCashFlowByMonth", () => {
  it("returns a zero-filled row for every month with no entries", () => {
    const rows = computeCashFlowByMonth([], { startIso: "2026-01-01", endIso: "2026-02-28" });
    expect(rows).toEqual([
      {
        monthKey: "2026-01",
        totalInJmd: 0,
        totalOutJmd: 0,
        netJmd: 0,
        openingBalanceJmd: 0,
        closingBalanceJmd: 0,
        entries: [],
        outEntries: [],
      },
      {
        monthKey: "2026-02",
        totalInJmd: 0,
        totalOutJmd: 0,
        netJmd: 0,
        openingBalanceJmd: 0,
        closingBalanceJmd: 0,
        entries: [],
        outEntries: [],
      },
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

// ---------------------------------------------------------------------------
// Cash OUT (2026-08-07 restructure — the statement's missing half)
// ---------------------------------------------------------------------------

describe("computeCashFlowByMonth — outflows", () => {
  it("defaults to no outflows, so the inflow-only call shape still means what it meant", () => {
    const rows = computeCashFlowByMonth([entry({ amountJmd: 100 })], RANGE);
    const jan = rows.find((r) => r.monthKey === "2026-01")!;
    expect(jan.outEntries).toEqual([]);
    expect(jan.totalOutJmd).toBe(0);
    expect(jan.netJmd).toBe(100);
  });

  it("buckets outflows by payment month and sorts them oldest-first", () => {
    const rows = computeCashFlowByMonth(
      [],
      RANGE,
      [
        outEntry({ amountJmd: 300, paidAtIso: "2026-03-20", description: "second" }),
        outEntry({ amountJmd: 100, paidAtIso: "2026-03-02", description: "first" }),
      ],
    );
    const march = rows.find((r) => r.monthKey === "2026-03")!;
    expect(march.totalOutJmd).toBe(400);
    expect(march.outEntries.map((e) => e.description)).toEqual(["first", "second"]);
  });

  it("nets inflows against outflows within each month", () => {
    const rows = computeCashFlowByMonth(
      [entry({ amountJmd: 1000, paidAtIso: "2026-01-10" })],
      RANGE,
      [outEntry({ amountJmd: 1500, paidAtIso: "2026-01-20" })],
    );
    const jan = rows.find((r) => r.monthKey === "2026-01")!;
    expect(jan.totalInJmd).toBe(1000);
    expect(jan.totalOutJmd).toBe(1500);
    expect(jan.netJmd).toBe(-500);
  });

  it("excludes outflows outside the range", () => {
    const rows = computeCashFlowByMonth([], RANGE, [outEntry({ amountJmd: 999, paidAtIso: "2025-06-01" })]);
    expect(totalCashOutJmd(rows)).toBe(0);
  });

  it("keeps the two outflow kinds separable for the statement's summary", () => {
    const rows = computeCashFlowByMonth(
      [],
      RANGE,
      [
        outEntry({ amountJmd: 700, kind: "cost_of_sales", paidAtIso: "2026-01-05" }),
        outEntry({ amountJmd: 300, kind: "operating_expense", paidAtIso: "2026-01-06" }),
      ],
    );
    expect(totalCashOutByKind(rows, "cost_of_sales")).toBe(700);
    expect(totalCashOutByKind(rows, "operating_expense")).toBe(300);
    expect(totalCashOutJmd(rows)).toBe(1000);
  });

  it("reports zero for a kind with no entries", () => {
    const rows = computeCashFlowByMonth([], RANGE, [outEntry({ kind: "operating_expense" })]);
    expect(totalCashOutByKind(rows, "cost_of_sales")).toBe(0);
  });
});

describe("computeCashFlowByMonth — running balance", () => {
  it("opens at zero and carries the cumulative net forward month by month", () => {
    const rows = computeCashFlowByMonth(
      [entry({ amountJmd: 1000, paidAtIso: "2026-01-10" }), entry({ amountJmd: 400, paidAtIso: "2026-03-10" })],
      { startIso: "2026-01-01", endIso: "2026-03-31" },
      [outEntry({ amountJmd: 600, paidAtIso: "2026-02-10" })],
    );

    expect(rows.map((r) => [r.monthKey, r.openingBalanceJmd, r.netJmd, r.closingBalanceJmd])).toEqual([
      ["2026-01", 0, 1000, 1000],
      ["2026-02", 1000, -600, 400],
      ["2026-03", 400, 400, 800],
    ]);
  });

  it("each month's opening equals the previous month's closing", () => {
    const rows = computeCashFlowByMonth(
      [entry({ amountJmd: 250, paidAtIso: "2026-02-01" })],
      { startIso: "2026-01-01", endIso: "2026-04-30" },
      [outEntry({ amountJmd: 90, paidAtIso: "2026-03-01" })],
    );
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].openingBalanceJmd).toBe(rows[i - 1].closingBalanceJmd);
    }
  });

  it("the final closing balance equals the period's net movement", () => {
    const rows = computeCashFlowByMonth(
      [entry({ amountJmd: 5000, paidAtIso: "2026-01-01" })],
      { startIso: "2026-01-01", endIso: "2026-03-31" },
      [outEntry({ amountJmd: 1200, paidAtIso: "2026-02-01" })],
    );
    expect(rows[rows.length - 1].closingBalanceJmd).toBe(netCashMovementJmd(rows));
    expect(netCashMovementJmd(rows)).toBe(3800);
  });

  it("stays at zero throughout when there is no activity at all", () => {
    const rows = computeCashFlowByMonth([], { startIso: "2026-01-01", endIso: "2026-02-28" });
    expect(rows.every((r) => r.openingBalanceJmd === 0 && r.closingBalanceJmd === 0)).toBe(true);
    expect(netCashMovementJmd(rows)).toBe(0);
  });
});

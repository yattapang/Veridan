import { describe, expect, it } from "vitest";
import { buildCurrentFxRate } from "../expenses/expense";
import { buildCashOutEntries, type FinancialStatementData } from "./load";
import type { ReportDateRange } from "./period";
import type { LedgerCostInput, LedgerExpenseInput } from "./transactions";

/**
 * `buildCashOutEntries` is the pure half of the cash-flow loader — it takes
 * already-fetched rows, so it is unit-testable without a Supabase client.
 */

const RANGE: ReportDateRange = { startIso: "2026-02-01", endIso: "2026-02-28" };
const ORDER_RATES = { o1: 200 };
const FX = buildCurrentFxRate(100, 0);
const NO_FX = buildCurrentFxRate(null, null);

function cost(overrides: Partial<LedgerCostInput> = {}): LedgerCostInput {
  return {
    orderId: "o1",
    category: "freight",
    amountUsd: null,
    amountJmd: 90_000,
    incurredDateIso: "2026-02-05",
    paidDateIso: "2026-02-10",
    description: "Ocean freight",
    supplierName: "Seaboard",
    quoteRef: "VQ-2026-001",
    companyName: "Sandals Resorts",
    ...overrides,
  };
}

function expense(overrides: Partial<LedgerExpenseInput> = {}): LedgerExpenseInput {
  return {
    categoryName: "rent_utilities",
    categoryLabel: "Rent & Utilities",
    amountJmd: 150_000,
    amountUsd: null,
    incurredDateIso: "2026-02-01",
    paidDateIso: "2026-02-05",
    description: "Office rent",
    vendor: "Kingston Properties",
    reference: "INV-4410",
    ...overrides,
  };
}

function data(overrides: Partial<FinancialStatementData> = {}): FinancialStatementData {
  return {
    issuedInvoices: [],
    payments: [],
    cashIn: [],
    costs: [],
    expenses: [],
    rateByOrderId: ORDER_RATES,
    fx: FX,
    ...overrides,
  };
}

describe("buildCashOutEntries — range filtering (MINOR m-1)", () => {
  it("includes a row paid inside the range", () => {
    const { entries } = buildCashOutEntries(data({ costs: [cost({ paidDateIso: "2026-02-10" })] }), RANGE);
    expect(entries).toHaveLength(1);
    expect(entries[0].amountJmd).toBe(90_000);
  });

  it("EXCLUDES a row the loader fetched for its OTHER date but which was paid outside the range", () => {
    // The loader deliberately fetches a cost when EITHER date is in range,
    // so a February-incurred bill paid in March arrives here — and is not a
    // February cash outflow.
    const { entries } = buildCashOutEntries(
      data({ costs: [cost({ incurredDateIso: "2026-02-05", paidDateIso: "2026-03-15" })] }),
      RANGE,
    );
    expect(entries).toEqual([]);
  });

  it("does NOT count an out-of-range unconvertible row toward the amber warning", () => {
    // This is the bug: before the range check, `unconvertedUsd` counted rows
    // the report does not show, overstating the shortfall.
    const { entries, unconvertedUsd } = buildCashOutEntries(
      data({
        costs: [cost({ orderId: "unknown", amountJmd: null, amountUsd: 500, paidDateIso: "2026-03-15" })],
        expenses: [expense({ amountJmd: null, amountUsd: 200, paidDateIso: "2025-12-01" })],
        fx: NO_FX,
      }),
      RANGE,
    );
    expect(entries).toEqual([]);
    expect(unconvertedUsd).toBe(0);
  });

  it("still counts an IN-range unconvertible row", () => {
    const { unconvertedUsd } = buildCashOutEntries(
      data({
        costs: [cost({ orderId: "unknown", amountJmd: null, amountUsd: 500, paidDateIso: "2026-02-10" })],
        expenses: [expense({ amountJmd: null, amountUsd: 200, paidDateIso: "2026-02-11" })],
        fx: NO_FX,
      }),
      RANGE,
    );
    expect(unconvertedUsd).toBe(700);
  });

  it("still excludes an unpaid row entirely — an unpaid bill has moved no money", () => {
    const { entries, unconvertedUsd } = buildCashOutEntries(
      data({ costs: [cost({ paidDateIso: null })], expenses: [expense({ paidDateIso: null })] }),
      RANGE,
    );
    expect(entries).toEqual([]);
    expect(unconvertedUsd).toBe(0);
  });
});

describe("buildCashOutEntries — FX disclosure gate (MAJOR M-3)", () => {
  it("is false when every outflow was recorded natively in JMD", () => {
    const { usedCurrentRateConversion } = buildCashOutEntries(
      data({ costs: [cost()], expenses: [expense()] }),
      RANGE,
    );
    expect(usedCurrentRateConversion).toBe(false);
  });

  it("is TRUE when a USD-only operating expense was converted at the live rate", () => {
    const { entries, usedCurrentRateConversion } = buildCashOutEntries(
      data({ expenses: [expense({ amountJmd: null, amountUsd: 300 })] }),
      RANGE,
    );
    expect(usedCurrentRateConversion).toBe(true);
    expect(entries[0].amountJmd).toBe(30_000); // 300 x the current rate of 100
  });

  it("is FALSE for a USD-only COST — that converts at its order's frozen quote rate, not the live one", () => {
    const { entries, usedCurrentRateConversion } = buildCashOutEntries(
      data({ costs: [cost({ amountJmd: null, amountUsd: 1_000 })] }),
      RANGE,
    );
    expect(entries[0].amountJmd).toBe(200_000); // 1,000 x the ORDER's locked 200
    expect(usedCurrentRateConversion).toBe(false);
  });

  it("is FALSE for a USD-only expense that could not be converted at all", () => {
    const { usedCurrentRateConversion } = buildCashOutEntries(
      data({ expenses: [expense({ amountJmd: null, amountUsd: 300 })], fx: NO_FX }),
      RANGE,
    );
    expect(usedCurrentRateConversion).toBe(false);
  });

  it("is FALSE for a USD-only expense the range excludes", () => {
    const { usedCurrentRateConversion } = buildCashOutEntries(
      data({ expenses: [expense({ amountJmd: null, amountUsd: 300, paidDateIso: "2026-03-15" })] }),
      RANGE,
    );
    expect(usedCurrentRateConversion).toBe(false);
  });

  it("never re-derives a JMD figure from a USD sibling on the same row", () => {
    const { entries, usedCurrentRateConversion } = buildCashOutEntries(
      data({ expenses: [expense({ amountJmd: 150_000, amountUsd: 999 })] }),
      RANGE,
    );
    expect(entries[0].amountJmd).toBe(150_000);
    expect(usedCurrentRateConversion).toBe(false);
  });
});

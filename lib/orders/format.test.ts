import { describe, expect, it } from "vitest";
import { computeActualCostTotals, convertAtQuoteRate, displayAmountsAtQuoteRate } from "./format";

const RATE = 166.86; // JMD per 1 USD, e.g. lib/invoices/amounts.test.ts's worked example scale

describe("convertAtQuoteRate", () => {
  it("converts USD to JMD at the given rate", () => {
    expect(convertAtQuoteRate(100, "usdToJmd", RATE)).toBeCloseTo(16686, 2);
  });

  it("converts JMD to USD at the given rate", () => {
    expect(convertAtQuoteRate(16686, "jmdToUsd", RATE)).toBeCloseTo(100, 2);
  });

  it("returns null for a non-finite or non-positive rate", () => {
    expect(convertAtQuoteRate(100, "usdToJmd", 0)).toBeNull();
    expect(convertAtQuoteRate(100, "usdToJmd", Number.NaN)).toBeNull();
    expect(convertAtQuoteRate(100, "usdToJmd", -5)).toBeNull();
  });

  it("returns null for a non-finite amount", () => {
    expect(convertAtQuoteRate(Number.NaN, "usdToJmd", RATE)).toBeNull();
  });
});

describe("displayAmountsAtQuoteRate", () => {
  it("passes both through unchanged when both are already present", () => {
    const result = displayAmountsAtQuoteRate({ amount_usd: 100, amount_jmd: 15000 }, RATE);
    expect(result).toEqual({ amountUsd: 100, amountJmd: 15000 });
  });

  it("fills in JMD from a USD-only row", () => {
    const result = displayAmountsAtQuoteRate({ amount_usd: 100, amount_jmd: null }, RATE);
    expect(result.amountUsd).toBe(100);
    expect(result.amountJmd).toBeCloseTo(16686, 2);
  });

  it("fills in USD from a JMD-only row", () => {
    const result = displayAmountsAtQuoteRate({ amount_usd: null, amount_jmd: 16686 }, RATE);
    expect(result.amountJmd).toBe(16686);
    expect(result.amountUsd).toBeCloseTo(100, 2);
  });

  it("returns nulls when both are missing (should not happen given the DB check constraint, but stays safe)", () => {
    expect(displayAmountsAtQuoteRate({ amount_usd: null, amount_jmd: null }, RATE)).toEqual({
      amountUsd: null,
      amountJmd: null,
    });
  });
});

describe("computeActualCostTotals", () => {
  it("returns empty totals for no rows", () => {
    const totals = computeActualCostTotals([], RATE);
    expect(totals.overall).toEqual({ amountUsd: null, amountJmd: null });
    expect(totals.byCategory).toEqual({});
  });

  it("sums same-category rows and grand totals across mixed currencies", () => {
    const rows = [
      { category: "hardware" as const, amount_usd: 100, amount_jmd: null },
      { category: "hardware" as const, amount_usd: null, amount_jmd: 16686 },
      { category: "freight" as const, amount_usd: 50, amount_jmd: null },
    ];
    const totals = computeActualCostTotals(rows, RATE);

    // hardware: 100 USD + (16686 JMD == 100 USD) = 200 USD, 33372 JMD
    expect(totals.byCategory.hardware.amountUsd).toBeCloseTo(200, 2);
    expect(totals.byCategory.hardware.amountJmd).toBeCloseTo(33372, 2);

    // freight: 50 USD only
    expect(totals.byCategory.freight.amountUsd).toBeCloseTo(50, 2);
    expect(totals.byCategory.freight.amountJmd).toBeCloseTo(8343, 2);

    // overall: 250 USD, 41715 JMD
    expect(totals.overall.amountUsd).toBeCloseTo(250, 2);
    expect(totals.overall.amountJmd).toBeCloseTo(41715, 2);
  });
});

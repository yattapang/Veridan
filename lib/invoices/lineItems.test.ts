import { describe, expect, it } from "vitest";
import { computeLineItemTotals } from "./lineItems";

describe("computeLineItemTotals", () => {
  it("computes each line's total and sums them into the subtotal", () => {
    const result = computeLineItemTotals([
      { description: "Door closer install", qty: 4, unitPriceJmd: 2500 },
      { description: "Site visit", qty: 1, unitPriceJmd: 15000 },
    ]);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ lineTotalJmd: 10000, sortOrder: 0 });
    expect(result.lines[1]).toMatchObject({ lineTotalJmd: 15000, sortOrder: 1 });
    expect(result.subtotalJmd).toBe(25000);
  });

  it("rounds a line total to 2dp using the same round2 helper lib/invoices/amounts.ts uses", () => {
    const result = computeLineItemTotals([{ description: "Hinge set", qty: 3, unitPriceJmd: 33.336 }]);
    // 3 x 33.336 = 100.008 -> rounds to 100.01.
    expect(result.lines[0].lineTotalJmd).toBe(100.01);
    expect(result.subtotalJmd).toBe(100.01);
  });

  it("drops a row with a blank description", () => {
    const result = computeLineItemTotals([
      { description: "  ", qty: 1, unitPriceJmd: 100 },
      { description: "Valid row", qty: 1, unitPriceJmd: 100 },
    ]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].description).toBe("Valid row");
    expect(result.subtotalJmd).toBe(100);
  });

  it("drops a row with a non-positive or non-finite qty", () => {
    const result = computeLineItemTotals([
      { description: "Zero qty", qty: 0, unitPriceJmd: 100 },
      { description: "Negative qty", qty: -1, unitPriceJmd: 100 },
      { description: "NaN qty", qty: NaN, unitPriceJmd: 100 },
    ]);
    expect(result.lines).toHaveLength(0);
    expect(result.subtotalJmd).toBe(0);
  });

  it("drops a row with a negative unit price but keeps a zero-priced row (e.g. a free line item)", () => {
    const result = computeLineItemTotals([
      { description: "Negative price", qty: 1, unitPriceJmd: -5 },
      { description: "Free line", qty: 2, unitPriceJmd: 0 },
    ]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].description).toBe("Free line");
    expect(result.lines[0].lineTotalJmd).toBe(0);
  });

  it("re-indexes sortOrder to only count surviving valid rows, not original positions", () => {
    const result = computeLineItemTotals([
      { description: "", qty: 1, unitPriceJmd: 100 },
      { description: "First valid", qty: 1, unitPriceJmd: 100 },
      { description: "Second valid", qty: 1, unitPriceJmd: 100 },
    ]);
    expect(result.lines.map((l) => l.sortOrder)).toEqual([0, 1]);
  });

  it("returns an empty result for no drafts", () => {
    const result = computeLineItemTotals([]);
    expect(result.lines).toEqual([]);
    expect(result.subtotalJmd).toBe(0);
  });
});

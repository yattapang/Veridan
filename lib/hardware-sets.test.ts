import { describe, expect, it } from "vitest";
import { nextSetCode, resolveLineCost, summarizeSetUsd, toUsdIndicative } from "./hardware-sets";
import type { HardwareSetLineItemWithDetails } from "@/lib/supabase/types";

function line(overrides: Partial<HardwareSetLineItemWithDetails> = {}): HardwareSetLineItemWithDetails {
  return {
    id: "line-1",
    hardware_set_id: "set-1",
    product_id: "prod-1",
    supplier_id: "sup-1",
    qty: 2,
    unit_cost_override: null,
    cost_currency_override: null,
    sort_order: 0,
    notes: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    products: {
      id: "prod-1",
      description: "Consort door closer",
      manufacturer: "Consort",
      product_ref: "CD-100",
      catalogue_ref: null,
      unit: "each",
      unit_cost: 50,
      cost_currency: "CAD",
    },
    suppliers: { id: "sup-1", name: "Consort Hardware", default_currency: "CAD" },
    ...overrides,
  };
}

describe("nextSetCode", () => {
  it("suggests HW01 for an empty project", () => {
    expect(nextSetCode([])).toBe("HW01");
  });

  it("increments past the highest existing HW code", () => {
    expect(nextSetCode(["HW01", "HW02", "HW04"])).toBe("HW05");
  });

  it("ignores non-matching codes", () => {
    expect(nextSetCode(["Custom-A", "HW03"])).toBe("HW04");
  });

  it("is case-insensitive", () => {
    expect(nextSetCode(["hw01"])).toBe("HW02");
  });
});

describe("resolveLineCost", () => {
  it("uses the product library cost when there is no override", () => {
    const resolved = resolveLineCost(line());
    expect(resolved).toEqual({ unitCost: 50, currency: "CAD", isOverride: false });
  });

  it("uses the per-line override when both cost and currency are set", () => {
    const resolved = resolveLineCost(
      line({ unit_cost_override: 45, cost_currency_override: "USD" })
    );
    expect(resolved).toEqual({ unitCost: 45, currency: "USD", isOverride: true });
  });

  it("falls back to the library value when only a partial override is set", () => {
    const resolved = resolveLineCost(line({ unit_cost_override: 45, cost_currency_override: null }));
    expect(resolved).toEqual({ unitCost: 50, currency: "CAD", isOverride: false });
  });

  it("returns null when the product join is missing", () => {
    expect(resolveLineCost(line({ products: null }))).toBeNull();
  });
});

describe("toUsdIndicative", () => {
  it("passes USD through unchanged", () => {
    expect(toUsdIndicative(100, "USD", {})).toBe(100);
  });

  it("multiplies native amount by the USD-per-unit rate", () => {
    expect(toUsdIndicative(100, "CAD", { CAD: 0.74 })).toBeCloseTo(74);
  });

  it("returns null when the rate is missing", () => {
    expect(toUsdIndicative(100, "GBP", {})).toBeNull();
  });
});

describe("summarizeSetUsd", () => {
  it("sums qty x resolved unit cost converted to USD", () => {
    const lines = [
      line({ qty: 2, products: { ...line().products!, unit_cost: 50, cost_currency: "CAD" } }),
      line({ id: "line-2", qty: 1, unit_cost_override: 100, cost_currency_override: "USD" }),
    ];
    const summary = summarizeSetUsd(lines, { CAD: 0.74 });
    // (2 * 50 * 0.74) + (1 * 100) = 74 + 100 = 174
    expect(summary.lineCount).toBe(2);
    expect(summary.subtotalUsd).toBeCloseTo(174);
    expect(summary.incomplete).toBe(false);
  });

  it("flags incomplete when a rate is missing", () => {
    const lines = [line({ products: { ...line().products!, cost_currency: "GBP" } })];
    const summary = summarizeSetUsd(lines, { CAD: 0.74 });
    expect(summary.incomplete).toBe(true);
  });
});

/**
 * Quote mapping-layer unit tests (Task 16, extended in Task 17).
 *
 * Covers the three things the Task 16 brief calls out for the pure
 * DB-rows→engine mapping:
 *   1. Quote ref generation (VQ-YYYY-NNN sequence).
 *   2. Origin grouping — a mixed-supplier door set spanning two origins
 *      collapses to two pools, and lines route to the right pool.
 *   3. Snapshot immutability — editing business parameters AFTER a quote's
 *      snapshot is taken must not change that quote's engine numbers.
 *
 * Task 17 (line_item mode, retrofit/simple jobs) adds:
 *   4. line_item-mode mapping with ad-hoc lines (product_id null,
 *      description_override carries the text, no door/hardware-set).
 *   5. Mixed library + ad-hoc lines across 2 origins, in line_item mode.
 *   6. door_register behavior is unchanged (per-door rollups still appear;
 *      a door_register-mode calculation with the same shape of inputs as
 *      before Task 17's schema relaxation produces identical numbers).
 *   7. planOriginRegroup — the pure diff behind line_item mode's
 *      add/edit/remove-a-line origin regrouping.
 */

import { describe, expect, it } from "vitest";
import { calculateQuote } from "../landed-cost/engine";
import type {
  BusinessParameterRow,
  ParametersSnapshotStored,
  QuoteLineItemRow,
  QuoteOriginRow,
} from "@/lib/supabase/types";
import {
  buildFxSnapshot,
  buildParametersSnapshot,
} from "./snapshot";
import {
  buildOriginGroups,
  buildQuoteCalculationInput,
  nextQuoteRef,
  planOriginRegroup,
  supplierOriginKey,
  supplierOriginLabelMap,
} from "./mapping";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function param(
  key: string,
  value: unknown,
  value_type: BusinessParameterRow["value_type"] = "numeric",
): BusinessParameterRow {
  return {
    id: key,
    key,
    value: { type: value_type === "percent" ? "numeric" : value_type, value } as never,
    value_type,
    description: null,
    updated_by: null,
    updated_at: "2026-07-15T00:00:00Z",
    created_at: "2026-07-15T00:00:00Z",
  };
}

/** A full seed-shaped parameter set, with `duty` overridable per call. */
function seedParams(duty = 55): BusinessParameterRow[] {
  return [
    param("duty_gct_pct", duty, "percent"),
    param("marine_insurance_pct", 1.5, "percent"),
    param("brokerage_first_pallet_usd", 120),
    param("brokerage_addl_pallet_usd", 50),
    param("port_handling_usd", 50),
    param("freight_insurance_fallback_usd", 1250),
    param("procurement_handling_fee_usd", 500),
    param("contingency_pct", 5, "percent"),
    param("margin_tiers", [30, 35, 40], "table"),
    param("margin_floor_pct", 20, "percent"),
    param("min_order_value_usd", 2000),
    param("deposit_standard_pct", 60, "percent"),
    param("quote_validity_days", 15),
    param("default_finish", "Satin Stainless Steel (US32D)", "text"),
    param("gct_enabled", false, "boolean"),
    param("gct_rate_pct", 15, "percent"),
    param("fx_bank_sell_rate_usd_jmd", 162),
    param("fx_risk_buffer_pct", 3, "percent"),
    param("supplier_fx_rates", { USD: 1, CAD: 0.74, GBP: 1.27, EUR: 1.08 }, "table"),
    param("lead_times", { UK: "4-8 weeks" }, "table"),
    param("company_details", { name: "Veridan Limited" }, "table"),
  ];
}

// ---------------------------------------------------------------------------
// (1) Quote ref generation
// ---------------------------------------------------------------------------

describe("nextQuoteRef", () => {
  it("starts at 001 when no refs exist for the year", () => {
    expect(nextQuoteRef(2026, [])).toBe("VQ-2026-001");
  });

  it("increments past the highest matching ref, zero-padded to 3 digits", () => {
    expect(nextQuoteRef(2026, ["VQ-2026-001", "VQ-2026-002"])).toBe("VQ-2026-003");
    expect(nextQuoteRef(2026, ["VQ-2026-009"])).toBe("VQ-2026-010");
  });

  it("ignores other years and non-conforming refs", () => {
    expect(
      nextQuoteRef(2026, ["VQ-2025-050", "VQ-2026-004", "legacy-7", "VQ-2026-abc"]),
    ).toBe("VQ-2026-005");
  });
});

// ---------------------------------------------------------------------------
// (2) Origin grouping
// ---------------------------------------------------------------------------

describe("origin grouping", () => {
  it("prefers origin_region, falls back to country, then 'Other'", () => {
    expect(supplierOriginKey({ id: "s1", origin_region: "UK–Consort", country: "UK" })).toBe("UK–Consort");
    expect(supplierOriginKey({ id: "s2", origin_region: null, country: "USA" })).toBe("USA");
    expect(supplierOriginKey({ id: "s3", origin_region: "  ", country: null })).toBe("Other");
  });

  it("collapses a mixed-supplier door set into one pool per origin", () => {
    // Two UK suppliers (same region) + one USA supplier → 2 pools, not 3.
    const groups = buildOriginGroups([
      { id: "consort", origin_region: "UK–Consort", country: "UK" },
      { id: "allgood", origin_region: "UK–Consort", country: "UK" },
      { id: "trudoor", origin_region: "USA–Miami", country: "USA" },
    ]);
    expect(groups).toHaveLength(2);
    const uk = groups.find((g) => g.label === "UK–Consort")!;
    const usa = groups.find((g) => g.label === "USA–Miami")!;
    expect(uk.supplierIds.sort()).toEqual(["allgood", "consort"]);
    expect(usa.supplierIds).toEqual(["trudoor"]);
  });

  it("routes each supplier to its pool label via the lookup", () => {
    const groups = buildOriginGroups([
      { id: "consort", origin_region: "UK–Consort", country: "UK" },
      { id: "trudoor", origin_region: "USA–Miami", country: "USA" },
    ]);
    const map = supplierOriginLabelMap(groups);
    expect(map.get("consort")).toBe("UK–Consort");
    expect(map.get("trudoor")).toBe("USA–Miami");
  });
});

// ---------------------------------------------------------------------------
// (3) Snapshot immutability
// ---------------------------------------------------------------------------

describe("snapshot immutability", () => {
  // One origin, one line, ocean freight itemized so duty% is the only lever
  // the test varies. Duty is a component of landed cost, so a change to the
  // live duty parameter WOULD move the number if the engine read it live.
  function makeOrigin(id: string): QuoteOriginRow {
    return {
      id,
      quote_id: "Q1",
      origin_label: "UK–Consort",
      supplier_invoice_total: null,
      freight_export_fees_usd: 0,
      ocean_freight_usd: 600,
      marine_insurance_usd: null,
      port_handling_usd: null,
      brokerage_usd: null,
      pallet_count: 1,
      duty_gct_pct: null, // ← falls back to the SNAPSHOT's duty, the lever under test
      cif_basis_usd: null,
      total_shipment_cost_usd: null,
      created_at: "",
      updated_at: "",
    };
  }

  function makeLine(id: string, originId: string): QuoteLineItemRow {
    return {
      id,
      quote_id: "Q1",
      door_id: "D1",
      hardware_set_id: "HW01",
      product_id: "P1",
      supplier_id: null,
      quote_origin_id: originId,
      description_override: null,
      qty: 1,
      unit_cost: 4500,
      cost_currency: "USD",
      unit_cost_usd: 4500,
      line_value_usd: 4500,
      allocated_shipment_cost_usd: null,
      landed_cost_usd: 4500,
      margin_pct_override: null,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    };
  }

  function landedFor(snapshot: ParametersSnapshotStored): number {
    const input = buildQuoteCalculationInput({
      mode: "door_register",
      quoteMarginPct: 30,
      parametersSnapshot: snapshot,
      fxSnapshot: buildFxSnapshot(seedParams(), "2026-07-15"),
      origins: [makeOrigin("O1")],
      lines: [makeLine("L1", "O1")],
    });
    return calculateQuote(input).lines[0].landedCostUsd;
  }

  it("freezes a quote's numbers against later parameter edits", () => {
    // Quote created when duty = 55%.
    const frozen = buildParametersSnapshot(seedParams(55));
    const landedAtCreation = landedFor(frozen);
    // CIF = 4500 + 600 = 5100; duty 55% = 2805; insurance 1.5% = 76.5;
    // adder = 600 + 2805 + 76.5 + 50 (port) + 120 (brokerage) = 3651.5.
    expect(landedAtCreation).toBeCloseTo(4500 + 3651.5, 6);

    // Founder later drops the LIVE duty parameter to 10%.
    const newLive = buildParametersSnapshot(seedParams(10));
    expect(newLive.duty_gct_pct).toBe(10); // the live world changed…

    // …but the quote still reads ITS OWN frozen snapshot → number unchanged.
    expect(landedFor(frozen)).toBe(landedAtCreation);
    // And a brand-new quote taken now would differ, proving the lever is real.
    expect(landedFor(newLive)).toBeLessThan(landedAtCreation);
  });

  it("builds a coherent snapshot even from a partially-seeded parameter set", () => {
    const sparse = buildParametersSnapshot([param("duty_gct_pct", 55, "percent")]);
    expect(sparse.margin_tiers).toEqual([30, 35, 40]); // seed default
    expect(sparse.port_handling_usd).toBe(50);
    expect(sparse.default_finish).toContain("Satin Stainless Steel");
  });

  it("precomputes the effective FX rate in the snapshot (162 × 1.03)", () => {
    const fx = buildFxSnapshot(seedParams(), "2026-07-15");
    expect(fx.bank_sell_rate).toBe(162);
    expect(fx.fx_buffer_pct).toBe(3);
    expect(fx.effective_rate).toBeCloseTo(166.86, 10);
    expect(fx.supplier_rates.GBP).toBe(1.27);
  });
});

// ---------------------------------------------------------------------------
// (4)-(6) Task 17 — line_item mode mapping (ad-hoc lines, mixed origins,
// door_register left unchanged)
// ---------------------------------------------------------------------------

describe("line_item mode mapping (Task 17)", () => {
  const snapshot = buildParametersSnapshot(seedParams());
  const fx = buildFxSnapshot(seedParams(), "2026-07-15");

  function origin(id: string, label: string): QuoteOriginRow {
    return {
      id,
      quote_id: "Q1",
      origin_label: label,
      supplier_invoice_total: null,
      freight_export_fees_usd: 0,
      ocean_freight_usd: 600,
      marine_insurance_usd: null,
      port_handling_usd: null,
      brokerage_usd: null,
      pallet_count: 1,
      duty_gct_pct: null,
      cif_basis_usd: null,
      total_shipment_cost_usd: null,
      created_at: "",
      updated_at: "",
    };
  }

  /** A line_item-mode line row: no door/hardware-set, optionally no product. */
  function line(args: {
    id: string;
    originId: string;
    productId: string | null;
    description?: string | null;
    unitCost?: number;
    supplierId?: string | null;
  }): QuoteLineItemRow {
    return {
      id: args.id,
      quote_id: "Q1",
      door_id: null,
      hardware_set_id: null,
      product_id: args.productId,
      supplier_id: args.supplierId ?? null,
      quote_origin_id: args.originId,
      description_override: args.description ?? null,
      qty: 1,
      unit_cost: args.unitCost ?? 500,
      cost_currency: "USD",
      unit_cost_usd: args.unitCost ?? 500,
      line_value_usd: args.unitCost ?? 500,
      allocated_shipment_cost_usd: null,
      landed_cost_usd: args.unitCost ?? 500,
      margin_pct_override: null,
      sort_order: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("prices an ad-hoc line (no product FK, no door) exactly like a library line", () => {
    const o1 = origin("O1", "UK–Consort");
    const adHoc = line({
      id: "L1",
      originId: "O1",
      productId: null,
      description: "Custom bracket — site measured",
      supplierId: "s-consort",
    });

    const input = buildQuoteCalculationInput({
      mode: "line_item",
      quoteMarginPct: 30,
      parametersSnapshot: snapshot,
      fxSnapshot: fx,
      origins: [o1],
      lines: [adHoc],
    });
    const result = calculateQuote(input);

    expect(result.errors).toEqual([]);
    expect(result.lines).toHaveLength(1);
    const lr = result.lines[0];
    expect(lr.productId).toBeNull();
    expect(lr.doorId).toBeNull();
    expect(lr.hardwareSetId).toBeNull();
    expect(lr.landedCostUsd).toBeGreaterThan(lr.lineValueUsd); // shipment cost got allocated
    // line_item mode never produces door rollups, even with zero doors involved.
    expect(result.doors).toEqual([]);
  });

  it("mixes library-picked and ad-hoc lines across two origins in one quote", () => {
    const o1 = origin("O1", "UK–Consort");
    const o2 = origin("O2", "USA–Miami");
    const libraryLine = line({ id: "L1", originId: "O1", productId: "P1", supplierId: "s-consort", unitCost: 900 });
    const adHocLine = line({
      id: "L2",
      originId: "O2",
      productId: null,
      description: "Site-fabricated threshold",
      supplierId: "s-miami",
      unitCost: 300,
    });

    const input = buildQuoteCalculationInput({
      mode: "line_item",
      quoteMarginPct: 30,
      parametersSnapshot: snapshot,
      fxSnapshot: fx,
      origins: [o1, o2],
      lines: [libraryLine, adHocLine],
    });
    const result = calculateQuote(input);

    expect(result.errors).toEqual([]);
    expect(result.origins).toHaveLength(2);
    const o1Result = result.origins.find((o) => o.originId === "O1")!;
    const o2Result = result.origins.find((o) => o.originId === "O2")!;
    expect(o1Result.supplierInvoiceTotalUsd).toBe(900);
    expect(o2Result.supplierInvoiceTotalUsd).toBe(300);

    // line_item-mode totals are the sum of ROUNDED per-line client prices,
    // never a door rollup (there are no doors in this mode) — §3.3.
    const expectedJmd = result.lines.reduce((s, l) => s + l.clientPriceJmdRounded, 0);
    expect(result.totals.clientPriceJmd).toBeCloseTo(expectedJmd, 2);
    expect(result.doors).toEqual([]);
  });

  it("leaves door_register behavior unchanged — per-door rollups still appear", () => {
    const o1 = origin("O1", "UK–Consort");
    const doorLine: QuoteLineItemRow = {
      ...line({ id: "L1", originId: "O1", productId: "P1", unitCost: 4500 }),
      door_id: "D1",
      hardware_set_id: "HW01",
    };

    const input = buildQuoteCalculationInput({
      mode: "door_register",
      quoteMarginPct: 30,
      parametersSnapshot: snapshot,
      fxSnapshot: fx,
      origins: [o1],
      lines: [doorLine],
    });
    const result = calculateQuote(input);

    expect(result.doors).toHaveLength(1);
    expect(result.doors[0].doorId).toBe("D1");
    expect(result.doors[0].hardwareSetId).toBe("HW01");
    // Door rollup's JMD is whole-dollar rounded, and it's what totals.clientPriceJmd sums from.
    expect(Number.isInteger(result.doors[0].clientPriceJmd)).toBe(true);
    expect(result.totals.clientPriceJmd).toBe(result.doors[0].clientPriceJmd);
  });
});

// ---------------------------------------------------------------------------
// (7) planOriginRegroup — pure diff behind line_item mode's per-line
// add/edit/remove origin regrouping (lib/quotes/persist.ts
// regroupLineItemOrigins)
// ---------------------------------------------------------------------------

describe("planOriginRegroup", () => {
  it("creates every label from scratch when there are no existing origins", () => {
    const groups = buildOriginGroups([
      { id: "consort", origin_region: "UK–Consort", country: "UK" },
      { id: "trudoor", origin_region: "USA–Miami", country: "USA" },
    ]);
    const plan = planOriginRegroup([], groups);
    expect(plan.labelsToCreate.sort()).toEqual(["UK–Consort", "USA–Miami"]);
    expect(plan.originIdsToRemove).toEqual([]);
    expect(plan.existingIdByLabel.size).toBe(0);
  });

  it("leaves matching origins alone and only creates what's missing", () => {
    const groups = buildOriginGroups([
      { id: "consort", origin_region: "UK–Consort", country: "UK" },
      { id: "trudoor", origin_region: "USA–Miami", country: "USA" },
    ]);
    const existing = [{ id: "orig-uk", origin_label: "UK–Consort" }];
    const plan = planOriginRegroup(existing, groups);
    expect(plan.labelsToCreate).toEqual(["USA–Miami"]);
    expect(plan.originIdsToRemove).toEqual([]);
    expect(plan.existingIdByLabel.get("UK–Consort")).toBe("orig-uk");
  });

  it("marks an origin for removal once no current line's supplier needs it", () => {
    // Quote used to have a UK line (now removed) and still has a USA line.
    const groups = buildOriginGroups([{ id: "trudoor", origin_region: "USA–Miami", country: "USA" }]);
    const existing = [
      { id: "orig-uk", origin_label: "UK–Consort" },
      { id: "orig-usa", origin_label: "USA–Miami" },
    ];
    const plan = planOriginRegroup(existing, groups);
    expect(plan.labelsToCreate).toEqual([]);
    expect(plan.originIdsToRemove).toEqual(["orig-uk"]);
    expect(plan.existingIdByLabel.get("USA–Miami")).toBe("orig-usa");
  });

  it("is a no-op when existing origins already match exactly", () => {
    const groups = buildOriginGroups([{ id: "consort", origin_region: "UK–Consort", country: "UK" }]);
    const existing = [{ id: "orig-uk", origin_label: "UK–Consort" }];
    const plan = planOriginRegroup(existing, groups);
    expect(plan.labelsToCreate).toEqual([]);
    expect(plan.originIdsToRemove).toEqual([]);
  });
});

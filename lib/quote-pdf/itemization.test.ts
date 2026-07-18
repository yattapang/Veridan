import { describe, expect, it } from "vitest";
import { buildQuoteItemization } from "./itemization";
import type { DoorRollup, LineResult } from "@/lib/landed-cost/types";
import type { QuoteLineItemWithDetails } from "@/lib/supabase/types";

function lineDetail(overrides: Partial<QuoteLineItemWithDetails> = {}): QuoteLineItemWithDetails {
  return {
    id: "line-1",
    quote_id: "quote-1",
    door_id: null,
    hardware_set_id: null,
    product_id: "prod-1",
    supplier_id: null,
    quote_origin_id: "origin-1",
    description_override: null,
    qty: 1,
    unit_cost: 100,
    cost_currency: "USD",
    unit_cost_usd: 100,
    line_value_usd: 100,
    allocated_shipment_cost_usd: null,
    landed_cost_usd: 120,
    margin_pct_override: null,
    sort_order: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    products: { id: "prod-1", description: "Lockset", manufacturer: null, product_ref: null, unit: "ea" },
    doors: null,
    hardware_sets: null,
    suppliers: null,
    ...overrides,
  } as QuoteLineItemWithDetails;
}

describe("buildQuoteItemization — line_item mode", () => {
  it("builds flat rows from qty/clientPriceJmdRounded and sums the grand total from rounded components", () => {
    const lines = [
      lineDetail({ id: "l1", qty: 2, products: { id: "p1", description: "Hinge", manufacturer: null, product_ref: null, unit: "ea" } }),
      lineDetail({ id: "l2", qty: 1, products: { id: "p2", description: "Closer", manufacturer: null, product_ref: null, unit: "ea" } }),
    ];
    const resultLines: LineResult[] = [
      { lineId: "l1", clientPriceJmdRounded: 2000 } as LineResult,
      { lineId: "l2", clientPriceJmdRounded: 1500 } as LineResult,
    ];

    const { doorGroups, flatLines, grandTotalJmd } = buildQuoteItemization({
      isDoorMode: false,
      lines,
      resultLines,
      resultDoors: [],
    });

    expect(doorGroups).toEqual([]);
    expect(flatLines).toEqual([
      { description: "Hinge", qty: 2, unitPriceJmd: 1000, lineTotalJmd: 2000 },
      { description: "Closer", qty: 1, unitPriceJmd: 1500, lineTotalJmd: 1500 },
    ]);
    // Sum of the already-rounded per-line totals, not a re-derivation.
    expect(grandTotalJmd).toBe(3500);
  });

  it("falls back to description_override when there is no product join", () => {
    const lines = [lineDetail({ id: "l1", products: null, description_override: "Ad-hoc item" })];
    const resultLines: LineResult[] = [{ lineId: "l1", clientPriceJmdRounded: 500 } as LineResult];

    const { flatLines } = buildQuoteItemization({ isDoorMode: false, lines, resultLines, resultDoors: [] });
    expect(flatLines[0].description).toBe("Ad-hoc item");
  });
});

describe("buildQuoteItemization — door_register mode", () => {
  it("groups doors by hardware set, summarizing composition and summing per-door prices", () => {
    const lines = [
      lineDetail({
        id: "l1",
        hardware_set_id: "hs1",
        hardware_sets: { id: "hs1", code: "HW-01", name: "Entry set" },
        doors: { id: "d1", door_number: "DE01", floor: "1" },
        products: { id: "p1", description: "Lockset", manufacturer: null, product_ref: null, unit: "ea" },
      }),
      lineDetail({
        id: "l2",
        hardware_set_id: "hs1",
        hardware_sets: { id: "hs1", code: "HW-01", name: "Entry set" },
        doors: { id: "d2", door_number: "DE02", floor: "1" },
        products: { id: "p1", description: "Lockset", manufacturer: null, product_ref: null, unit: "ea" },
      }),
    ];
    const resultDoors: DoorRollup[] = [
      { doorId: "d1", hardwareSetId: "hs1", lineIds: ["l1"], landedCostUsd: 0, clientPriceUsd: 0, clientPriceJmd: 5000 } as DoorRollup,
      { doorId: "d2", hardwareSetId: "hs1", lineIds: ["l2"], landedCostUsd: 0, clientPriceUsd: 0, clientPriceJmd: 5000 } as DoorRollup,
    ];

    const { doorGroups, flatLines, grandTotalJmd } = buildQuoteItemization({
      isDoorMode: true,
      lines,
      resultLines: [],
      resultDoors,
    });

    expect(flatLines).toEqual([]);
    expect(doorGroups).toHaveLength(1);
    expect(doorGroups[0]).toMatchObject({
      setCode: "HW-01",
      setName: "Entry set",
      doorNumbers: ["DE01", "DE02"],
      doorCount: 2,
      pricePerDoorJmd: 5000,
      totalJmd: 10000,
    });
    expect(grandTotalJmd).toBe(10000);
  });

  it("ignores door rollups with no hardware set", () => {
    const resultDoors: DoorRollup[] = [
      { doorId: "d1", hardwareSetId: null, lineIds: ["l1"], landedCostUsd: 0, clientPriceUsd: 0, clientPriceJmd: 5000 } as DoorRollup,
    ];
    const { doorGroups, grandTotalJmd } = buildQuoteItemization({
      isDoorMode: true,
      lines: [lineDetail({ id: "l1" })],
      resultLines: [],
      resultDoors,
    });
    expect(doorGroups).toEqual([]);
    expect(grandTotalJmd).toBe(0);
  });
});

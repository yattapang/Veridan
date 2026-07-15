/**
 * Landed-cost engine unit tests (Task 9).
 *
 * ============================================================================
 * GOLDEN TEST — Business Plan §8.2 worked example: DOCUMENTED DISCREPANCY
 * ============================================================================
 * The Business Plan's §8.2 example gives: supplier cost $4,500, freight $600,
 * CIF $5,100, duty 55% = $2,805, brokerage $300, port $45 — and then states a
 * landed total of $6,875 with tier prices $9,821.43 / $10,577 / $11,458
 * (÷0.70 / 0.65 / 0.60).
 *
 * Those two halves are INTERNALLY INCONSISTENT. Summing the doc's own stated
 * components per the §3.2 algorithm:
 *   total shipment adder = 600 (freight) + 2,805 (duty) + 300 (brokerage)
 *                        + 45 (port) = 3,750
 *   landed = 4,500 + 3,750 = 8,250   — NOT 6,875.
 * Back-solving the doc's $6,875 implies an effective duty of only ~28% of CIF
 * (actual Order 1 duty ran ~20.6% of CIF): the $6,875 figure predates the 55%
 * composite duty parameter and was never updated when the rate was.
 *
 * RULING (confirmed by the build coordinator, 2026-07-13): the ALGORITHM WINS.
 * With duty at 55% of the $5,100 CIF basis, landed = $8,250 and the tier
 * prices are 8,250 ÷ 0.70 / 0.65 / 0.60 = $11,785.71 / $12,692.31 / $13,750.00.
 * These are the golden values asserted below. The final parity authority
 * remains the real workbook in Task 25, which computes duty at 55%.
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import {
  brokerageUsd,
  calculateQuote,
  effectiveJmdRate,
  roundHalfUp,
  toUsd,
} from "./engine";
import type {
  EngineParams,
  FxSnapshot,
  OriginCostInput,
  QuoteCalculationInput,
  QuoteLineInput,
} from "./types";

// ---------------------------------------------------------------------------
// Shared fixtures (PRD §7 defaults)
// ---------------------------------------------------------------------------

const params: EngineParams = {
  fallbackFreightInsuranceUsd: 1250,
  brokerageFirstPalletUsd: 120,
  brokerageAddlPalletUsd: 50,
  marginFloorPct: 20,
  marginTiersPct: [30, 35, 40],
};

const fx: FxSnapshot = {
  bankSellRate: 162,
  fxBufferPct: 3,
  supplierRates: { CAD: 0.74, GBP: 1.27, EUR: 1.08 },
};

function origin(overrides: Partial<OriginCostInput> & { id: string }): OriginCostInput {
  return {
    label: overrides.id,
    freightExportFeesUsd: 0,
    oceanFreightUsd: null,
    marineInsurancePct: 1.5,
    palletCount: 1,
    portHandlingUsd: 50,
    dutyGctPct: 55,
    ...overrides,
  };
}

function line(overrides: Partial<QuoteLineInput> & { id: string; originId: string }): QuoteLineInput {
  return { qty: 1, unitCost: 100, costCurrency: "USD", ...overrides };
}

function quoteInput(overrides: Partial<QuoteCalculationInput>): QuoteCalculationInput {
  return {
    mode: "line_item",
    lines: [],
    origins: [],
    fx,
    margin: { quoteMarginPct: 30 },
    params,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (a) Golden test — Business Plan §8.2 worked example (corrected, see header)
// ---------------------------------------------------------------------------

describe("golden: Business Plan §8.2 worked example", () => {
  // Supplier $4,500 · itemized freight $600 · CIF $5,100 · duty 55% = $2,805
  // brokerage $300 (workbook's figure, entered as an override — the formula
  // 120 + 50×(n−1) has no integer pallet count yielding exactly 300) ·
  // port $45 · no insurance itemized in the example (0% / no override).
  const goldenInput = (marginPct: number) =>
    quoteInput({
      lines: [line({ id: "L1", originId: "O1", qty: 1, unitCost: 4500 })],
      origins: [
        origin({
          id: "O1",
          oceanFreightUsd: 600,
          marineInsurancePct: 0,
          brokerageUsdOverride: 300,
          portHandlingUsd: 45,
          dutyGctPct: 55,
        }),
      ],
      margin: { quoteMarginPct: marginPct },
    });

  it("reproduces CIF, duty, and landed cost per the §3.2 algorithm", () => {
    const r = calculateQuote(goldenInput(30));
    const o = r.origins[0];
    expect(o.cifBasisUsd).toBeCloseTo(5100, 10);
    expect(o.dutyGctUsd).toBeCloseTo(2805, 10);
    expect(o.totalShipmentCostUsd).toBeCloseTo(3750, 10); // 600+2805+300+45
    // Doc claims $6,875 here — see file-header discrepancy note. The
    // algorithmically correct landed cost with 55% duty is $8,250.
    expect(r.lines[0].landedCostUsd).toBeCloseTo(8250, 10);
    expect(r.totals.landedCostUsd).toBe(8250);
    expect(r.errors).toEqual([]);
  });

  it.each([
    [30, 11785.71], // 8250 / 0.70  (doc's stale figure: 9,821.43)
    [35, 12692.31], // 8250 / 0.65  (doc's stale figure: 10,577)
    [40, 13750.0], // 8250 / 0.60  (doc's stale figure: 11,458)
  ])("prices the landed cost at %i%% margin → $%d", (marginPct, expected) => {
    const r = calculateQuote(goldenInput(marginPct));
    expect(r.lines[0].clientPriceUsdRounded).toBe(expected);
    expect(r.flags).toEqual([]);
    expect(r.requiresOverride).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) Multi-origin allocation with mixed-supplier door sets
// ---------------------------------------------------------------------------

describe("multi-origin pro-rata allocation", () => {
  // Two doors sharing hardware set HW03; each door's set mixes origins:
  // UK (closer+hinges) and USA (lockset+stop), per PRD §6.1's example.
  const input = quoteInput({
    mode: "door_register",
    lines: [
      // Door D1
      line({ id: "d1-closer", originId: "UK", doorId: "D1", hardwareSetId: "HW03", qty: 1, unitCost: 200 }),
      line({ id: "d1-lockset", originId: "USA", doorId: "D1", hardwareSetId: "HW03", qty: 1, unitCost: 300 }),
      // Door D2
      line({ id: "d2-closer", originId: "UK", doorId: "D2", hardwareSetId: "HW03", qty: 2, unitCost: 200 }),
      line({ id: "d2-lockset", originId: "USA", doorId: "D2", hardwareSetId: "HW03", qty: 1, unitCost: 100 }),
    ],
    origins: [
      origin({ id: "UK", oceanFreightUsd: 500, freightExportFeesUsd: 100, palletCount: 2 }),
      origin({ id: "USA", oceanFreightUsd: 300, palletCount: 1 }),
    ],
  });
  const r = calculateQuote(input);

  it("computes each origin pool over only its own lines", () => {
    const uk = r.origins.find((o) => o.originId === "UK")!;
    const usa = r.origins.find((o) => o.originId === "USA")!;
    expect(uk.supplierInvoiceTotalUsd).toBeCloseTo(600, 10); // 200 + 400
    expect(usa.supplierInvoiceTotalUsd).toBeCloseTo(400, 10); // 300 + 100
    expect(uk.cifBasisUsd).toBeCloseTo(600 + 100 + 500, 10);
    expect(usa.cifBasisUsd).toBeCloseTo(400 + 0 + 300, 10);
    expect(uk.brokerageUsd).toBe(170); // 120 + 50×1
    expect(usa.brokerageUsd).toBe(120);
  });

  it("allocation shares sum to 1 within each origin", () => {
    for (const originId of ["UK", "USA"]) {
      const shares = r.lines
        .filter((l) => l.originId === originId)
        .reduce((s, l) => s + l.allocationShare, 0);
      expect(shares).toBeCloseTo(1, 12);
    }
  });

  it("allocated line costs reassemble the origin's shipment total, and the breakdown reassembles the allocation", () => {
    for (const o of r.origins) {
      const allocated = r.lines
        .filter((l) => l.originId === o.originId)
        .reduce((s, l) => s + l.allocatedShipmentCostUsd, 0);
      expect(allocated).toBeCloseTo(o.totalShipmentCostUsd, 8);
    }
    for (const l of r.lines) {
      const b = l.allocatedBreakdown;
      const sum =
        b.freightExportFeesUsd + b.oceanFreightUsd + b.marineInsuranceUsd +
        b.portHandlingUsd + b.brokerageUsd + b.dutyGctUsd;
      expect(sum).toBeCloseTo(l.allocatedShipmentCostUsd, 8);
    }
  });

  it("rolls up per door across both origins (Step 5)", () => {
    expect(r.doors).toHaveLength(2);
    const d1 = r.doors.find((d) => d.doorId === "D1")!;
    const d1Lines = r.lines.filter((l) => l.doorId === "D1");
    expect(d1.landedCostUsd).toBe(
      roundHalfUp(d1Lines.reduce((s, l) => s + l.landedCostUsd, 0), 2),
    );
    expect(d1.hardwareSetId).toBe("HW03");
    // Whole-JMD per door (§3.3).
    expect(Number.isInteger(d1.clientPriceJmd)).toBe(true);
  });

  it("quote JMD total = sum of whole-JMD door components", () => {
    expect(r.totals.clientPriceJmd).toBe(
      r.doors.reduce((s, d) => s + d.clientPriceJmd, 0),
    );
  });
});

// ---------------------------------------------------------------------------
// (c) FX conversion — multiply direction (§7.1 item 9)
// ---------------------------------------------------------------------------

describe("FX conversion (USD per 1 native unit — multiply)", () => {
  it("converts GBP by multiplying: £100 × 1.27 = $127", () => {
    expect(toUsd(100, "GBP", fx)).toBeCloseTo(127, 10);
  });
  it("converts CAD by multiplying: C$100 × 0.74 = $74", () => {
    expect(toUsd(100, "CAD", fx)).toBeCloseTo(74, 10);
  });
  it("converts EUR by multiplying: €100 × 1.08 = $108", () => {
    expect(toUsd(100, "EUR", fx)).toBeCloseTo(108, 10);
  });
  it("passes USD through untouched with no rate entry needed", () => {
    expect(toUsd(123.45, "USD", { ...fx, supplierRates: {} })).toBe(123.45);
  });
  it("normalizes mixed-currency lines within one origin", () => {
    const r = calculateQuote(
      quoteInput({
        lines: [
          line({ id: "gbp", originId: "O1", qty: 2, unitCost: 50, costCurrency: "GBP" }),
          line({ id: "usd", originId: "O1", qty: 1, unitCost: 73 }),
        ],
        origins: [origin({ id: "O1", oceanFreightUsd: 100 })],
      }),
    );
    const gbp = r.lines.find((l) => l.lineId === "gbp")!;
    expect(gbp.unitCostUsd).toBeCloseTo(63.5, 10);
    expect(gbp.lineValueUsd).toBeCloseTo(127, 10);
    expect(r.origins[0].supplierInvoiceTotalUsd).toBeCloseTo(200, 10);
  });
  it("emits a structured missing_fx_rate error instead of guessing", () => {
    const r = calculateQuote(
      quoteInput({
        lines: [line({ id: "jmd", originId: "O1", costCurrency: "JMD" })],
        origins: [origin({ id: "O1" })],
      }),
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: "missing_fx_rate", currency: "JMD", lineIds: ["jmd"] });
    expect(r.lines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (d) $1,250 fallback freight — supersede, never add (§7.1 item 2)
// ---------------------------------------------------------------------------

describe("fallback freight+insurance ($1,250)", () => {
  it("applies the fallback when ocean freight is absent, and suppresses the 1.5% insurance formula (superseded, not added)", () => {
    const r = calculateQuote(
      quoteInput({
        lines: [line({ id: "L1", originId: "O1", unitCost: 1000 })],
        origins: [origin({ id: "O1", oceanFreightUsd: null, marineInsurancePct: 1.5 })],
      }),
    );
    const o = r.origins[0];
    expect(o.usedFallbackFreight).toBe(true);
    expect(o.oceanFreightAppliedUsd).toBe(1250);
    expect(o.cifBasisUsd).toBeCloseTo(1000 + 1250, 10);
    expect(o.marineInsuranceUsd).toBe(0); // NOT 1.5% × CIF on top of the 1,250
    // adder = 1250 + 0 + 50 (port) + 120 (brokerage) + 55%×2250 (duty)
    expect(o.totalShipmentCostUsd).toBeCloseTo(1250 + 50 + 120 + 1237.5, 10);
  });

  it("uses itemized freight + 1.5% insurance once real freight is entered (fallback fully superseded)", () => {
    const r = calculateQuote(
      quoteInput({
        lines: [line({ id: "L1", originId: "O1", unitCost: 1000 })],
        origins: [origin({ id: "O1", oceanFreightUsd: 600, marineInsurancePct: 1.5 })],
      }),
    );
    const o = r.origins[0];
    expect(o.usedFallbackFreight).toBe(false);
    expect(o.oceanFreightAppliedUsd).toBe(600); // no 1,250 anywhere
    expect(o.cifBasisUsd).toBeCloseTo(1600, 10);
    expect(o.marineInsuranceUsd).toBeCloseTo(0.015 * 1600, 10);
  });

  it("treats an explicit $0 ocean freight as itemized (not as 'absent')", () => {
    const r = calculateQuote(
      quoteInput({
        lines: [line({ id: "L1", originId: "O1", unitCost: 1000 })],
        origins: [origin({ id: "O1", oceanFreightUsd: 0 })],
      }),
    );
    expect(r.origins[0].usedFallbackFreight).toBe(false);
    expect(r.origins[0].oceanFreightAppliedUsd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// brokerage formula
// ---------------------------------------------------------------------------

describe("brokerage = 120 + 50 × max(pallets − 1, 0)", () => {
  it.each([
    [1, 120],
    [2, 170],
    [4, 270],
    [0, 120], // zero-pallet edge case: max() clamps, never negative
  ])("%i pallet(s) → $%i", (pallets, expected) => {
    expect(brokerageUsd(pallets, params)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// (e) Floor violations flagged (§6.3.4–5)
// ---------------------------------------------------------------------------

describe("margin hard floor and override flags", () => {
  const oneLine = (marginPct: number, override?: number) =>
    quoteInput({
      lines: [line({ id: "L1", originId: "O1", unitCost: 1000, marginPctOverride: override ?? null })],
      origins: [origin({ id: "O1", oceanFreightUsd: 0 })],
      margin: { quoteMarginPct: marginPct },
    });

  it("flags margin below the 20% floor", () => {
    const r = calculateQuote(oneLine(15));
    expect(r.flags).toHaveLength(1);
    expect(r.flags[0].type).toBe("margin_below_floor");
    expect(r.requiresOverride).toBe(true);
  });

  it("flags price below landed cost (negative margin) with both flag types", () => {
    const r = calculateQuote(oneLine(-10));
    const types = r.flags.map((f) => f.type).sort();
    expect(types).toEqual(["margin_below_floor", "price_below_landed_cost"]);
    const l = r.lines[0];
    expect(l.clientPriceUsd).toBeLessThan(l.landedCostUsd);
  });

  it("flags a non-tier margin above the floor as margin_below_tier", () => {
    const r = calculateQuote(oneLine(25));
    expect(r.flags.map((f) => f.type)).toEqual(["margin_below_tier"]);
  });

  it("applies margin PER LINE with per-line overrides (§7.1 item 8)", () => {
    const r = calculateQuote(
      quoteInput({
        lines: [
          line({ id: "a", originId: "O1", unitCost: 500 }),
          line({ id: "b", originId: "O1", unitCost: 500, marginPctOverride: 40 }),
        ],
        origins: [origin({ id: "O1", oceanFreightUsd: 0 })],
        margin: { quoteMarginPct: 30 },
      }),
    );
    const a = r.lines.find((l) => l.lineId === "a")!;
    const b = r.lines.find((l) => l.lineId === "b")!;
    expect(a.marginPct).toBe(30);
    expect(b.marginPct).toBe(40);
    expect(a.clientPriceUsd).toBeCloseTo(a.landedCostUsd / 0.7, 10);
    expect(b.clientPriceUsd).toBeCloseTo(b.landedCostUsd / 0.6, 10);
  });

  it("does not flag clean tier margins", () => {
    for (const tier of [30, 35, 40]) {
      const r = calculateQuote(oneLine(tier));
      expect(r.flags).toEqual([]);
      expect(r.requiresOverride).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// (f) Zero-value origin guard (§3.2 Step 4)
// ---------------------------------------------------------------------------

describe("zero-value origin guard", () => {
  it("skips the origin and returns a structured error — never divides by zero", () => {
    const r = calculateQuote(
      quoteInput({
        lines: [
          line({ id: "zero", originId: "BAD", qty: 0, unitCost: 100 }),
          line({ id: "ok", originId: "GOOD", unitCost: 100 }),
        ],
        origins: [origin({ id: "BAD" }), origin({ id: "GOOD", oceanFreightUsd: 0 })],
      }),
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ code: "zero_value_origin", originId: "BAD", lineIds: ["zero"] });
    const bad = r.origins.find((o) => o.originId === "BAD")!;
    expect(bad.skipped).toBe(true);
    // The healthy origin still prices normally; no NaN/Infinity leaks anywhere.
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].lineId).toBe("ok");
    expect(Number.isFinite(r.totals.clientPriceUsd)).toBe(true);
    expect(Number.isFinite(r.totals.clientPriceJmd)).toBe(true);
  });

  it("reports lines pointing at a nonexistent origin as unknown_origin", () => {
    const r = calculateQuote(
      quoteInput({ lines: [line({ id: "lost", originId: "NOPE" })], origins: [] }),
    );
    expect(r.errors[0]).toMatchObject({ code: "unknown_origin", lineIds: ["lost"] });
    expect(r.lines).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (g) Rounding edge cases (§3.3)
// ---------------------------------------------------------------------------

describe("rounding (§3.3)", () => {
  it("roundHalfUp is exact on binary-hostile half-cent boundaries", () => {
    expect(roundHalfUp(1.005, 2)).toBe(1.01); // Math.round(1.005*100)/100 gives 1.00
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
    expect(roundHalfUp(1234.565, 2)).toBe(1234.57);
    expect(roundHalfUp(-1.005, 2)).toBe(-1.01); // half-up = away from zero
    expect(roundHalfUp(166.5, 0)).toBe(167);
    expect(roundHalfUp(0.004999999, 2)).toBe(0);
  });

  it("keeps full precision through the pipeline, rounding only at outputs", () => {
    // 3 equal lines split a $100 adder: each allocated 33.333… — full
    // precision internally, 2dp only on the rounded price fields.
    const r = calculateQuote(
      quoteInput({
        lines: [1, 2, 3].map((n) =>
          line({ id: `L${n}`, originId: "O1", unitCost: 100 }),
        ),
        origins: [
          origin({
            id: "O1",
            oceanFreightUsd: 0,
            marineInsurancePct: 0,
            dutyGctPct: 0,
            portHandlingUsd: 0,
            brokerageUsdOverride: 100,
          }),
        ],
        margin: { quoteMarginPct: 30 },
      }),
    );
    const l = r.lines[0];
    expect(l.allocatedShipmentCostUsd).toBeCloseTo(100 / 3, 12); // unrounded
    expect(l.landedCostUsd).toBeCloseTo(133.33333333333334, 12);
    expect(l.clientPriceUsd).toBeCloseTo(133.33333333333334 / 0.7, 12);
    expect(l.clientPriceUsdRounded).toBe(190.48);
  });

  it("grand total = sum of rounded components, not the rounded unrounded-sum", () => {
    // Each line prices at $0.10/0.998 ≈ 0.100200…, rounding to $0.10; 25 of
    // them: sum-of-rounded = 2.50, rounded-sum = round(2.5050…) = 2.51.
    const r = calculateQuote(
      quoteInput({
        lines: Array.from({ length: 25 }, (_, i) =>
          line({ id: `L${i}`, originId: "O1", unitCost: 0.1, marginPctOverride: 0.2 }),
        ),
        origins: [
          origin({
            id: "O1",
            oceanFreightUsd: 0,
            marineInsurancePct: 0,
            dutyGctPct: 0,
            portHandlingUsd: 0,
            brokerageUsdOverride: 0,
          }),
        ],
        params: { ...params, marginFloorPct: 0, marginTiersPct: undefined },
      }),
    );
    const unroundedSum = r.lines.reduce((s, l) => s + l.clientPriceUsd, 0);
    expect(roundHalfUp(unroundedSum, 2)).toBe(2.51); // what §3.3 forbids
    expect(r.totals.clientPriceUsd).toBe(2.5); // sum of rounded components
  });
});

// ---------------------------------------------------------------------------
// (h) JMD buffer math (Step 7)
// ---------------------------------------------------------------------------

describe("JMD conversion with FX buffer", () => {
  it("effective rate = 162 × 1.03 = 166.86, computed once from the snapshot", () => {
    expect(effectiveJmdRate(fx)).toBeCloseTo(166.86, 10);
    const r = calculateQuote(
      quoteInput({
        lines: [line({ id: "L1", originId: "O1", unitCost: 100 })],
        origins: [
          origin({
            id: "O1",
            oceanFreightUsd: 0,
            marineInsurancePct: 0,
            dutyGctPct: 0,
            portHandlingUsd: 0,
            brokerageUsdOverride: 0,
          }),
        ],
        margin: { quoteMarginPct: 30 },
      }),
    );
    expect(r.effectiveJmdRate).toBeCloseTo(166.86, 10);
    // price = 100/0.7 = 142.857142…; JMD = × 166.86 = 23,837.142857…
    expect(r.lines[0].clientPriceJmd).toBeCloseTo((100 / 0.7) * 166.86, 8);
    expect(r.lines[0].clientPriceJmdRounded).toBe(23837.14);
    expect(r.totals.clientPriceJmd).toBe(23837.14); // line_item mode: 2dp lines
  });

  it("a zero buffer leaves the bank rate untouched", () => {
    expect(effectiveJmdRate({ ...fx, fxBufferPct: 0 })).toBe(162);
  });
});

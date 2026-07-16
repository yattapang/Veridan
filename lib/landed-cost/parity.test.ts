/**
 * §6.5 PARITY REGRESSION (Task 25).
 *
 * Locks in the numbers the workbook-parity run (scripts/parity-test.mts)
 * validated, so a future engine change can't silently drift away from the
 * real Veridan_Quote_Template.xlsx behaviour without a red test.
 *
 * Two things are asserted:
 *  1. The USA / Origin-2 (Trudoor, Miami) landed-cost chain the workbook's
 *     Landed Cost Calculator computes — the ONE origin whose workbook formulas
 *     are internally consistent — is reproduced by the engine on the same
 *     inputs, EXCEPT the duty base (documented divergence: the workbook folds
 *     marine insurance + port into the duty base; the engine, per build plan
 *     §3.2 and the §8.2 golden test, computes duty on CIF = cost + freight).
 *  2. The zero-value UK / Consort origin (every Consort item priced $0 in the
 *     library, its cost carried in the workbook's package-price column) is
 *     skipped by the zero_value_origin guard rather than dividing by zero.
 *
 * See docs/PARITY_REPORT.md for the full methodology and root-cause analysis.
 */

import { describe, expect, it } from "vitest";
import { calculateQuote } from "./engine";
import type { EngineParams, FxSnapshot, QuoteCalculationInput } from "./types";

const params: EngineParams = {
  fallbackFreightInsuranceUsd: 1250,
  brokerageFirstPalletUsd: 120,
  brokerageAddlPalletUsd: 50,
  marginFloorPct: 20,
  marginTiersPct: [30, 35, 40],
};

// Workbook Assumptions: flat 162, no buffer, USD-priced Trudoor items.
const fx: FxSnapshot = { bankSellRate: 162, fxBufferPct: 0, supplierRates: { USD: 1, GBP: 1.27 } };

// The Trudoor hardware invoice the workbook auto-sums (Hardware Schedule AC57)
// is $7,603.20 across the priced items 1/2/3. Represent it as one line so the
// origin's supplier-invoice total is exactly that value.
const TRUDOOR_INVOICE = 7603.2;

describe("§6.5 parity — USA/Origin-2 (Trudoor, Miami) landed chain", () => {
  const input: QuoteCalculationInput = {
    mode: "line_item",
    lines: [{ id: "trudoor", originId: "USA", qty: 1, unitCost: TRUDOOR_INVOICE, costCurrency: "USD" }],
    origins: [
      {
        id: "USA",
        label: "USA–Miami",
        freightExportFeesUsd: 50, // Miami consolidator fee (Landed Cost Calc C31)
        oceanFreightUsd: 200, // Miami → Kingston (C32)
        marineInsurancePct: 1.5, // C33
        brokerageUsdOverride: 0, // workbook bundles agent fees into port; no brokerage line
        portHandlingUsd: 150, // Port / customs handling (C34)
        dutyGctPct: 55, // C35
        palletCount: 1,
      },
    ],
    fx,
    margin: { quoteMarginPct: 30 },
    params,
  };

  const r = calculateQuote(input);
  const o = r.origins[0];

  it("matches the workbook on invoice, CIF, and marine insurance", () => {
    expect(o.supplierInvoiceTotalUsd).toBeCloseTo(7603.2, 6);
    expect(o.cifBasisUsd).toBeCloseTo(7853.2, 6); // 7603.2 + 50 + 200
    expect(o.marineInsuranceUsd).toBeCloseTo(117.798, 6); // 1.5% × 7853.2
  });

  it("computes duty on CIF = cost+freight (§3.2), a documented narrower base than the workbook", () => {
    // App base = CIF (7853.2); workbook base = CIF + insurance + port (8120.998).
    expect(o.dutyGctUsd).toBeCloseTo(4319.26, 4); // 55% × 7853.2
    const workbookDuty = (7853.2 + 117.798 + 150) * 0.55;
    expect(workbookDuty).toBeCloseTo(4466.5489, 4);
    // The entire landed delta is exactly this duty-base difference.
    expect(workbookDuty - o.dutyGctUsd).toBeCloseTo(147.2889, 4);
  });

  it("reproduces the origin-2 total landed cost within the documented $147.29 duty-base delta", () => {
    const appLanded = o.supplierInvoiceTotalUsd + o.totalShipmentCostUsd;
    expect(appLanded).toBeCloseTo(12440.258, 3);
    const workbookLanded = 12587.5469;
    expect(workbookLanded - appLanded).toBeCloseTo(147.289, 3);
  });

  it("has no margin/floor flags at the 30% tier", () => {
    expect(r.flags).toEqual([]);
    expect(r.requiresOverride).toBe(false);
  });
});

describe("§6.5 parity — zero-value UK/Consort origin is skipped, not divided by zero", () => {
  const input: QuoteCalculationInput = {
    mode: "door_register",
    lines: [
      // Consort line, priced $0 (cost carried in the workbook package-price column).
      { id: "consort", originId: "UK", doorId: "D1", hardwareSetId: "HW01", qty: 4, unitCost: 0, costCurrency: "USD" },
      // Trudoor line on the same door, real cost.
      { id: "trudoor", originId: "USA", doorId: "D1", hardwareSetId: "HW01", qty: 1, unitCost: 194.4, costCurrency: "USD" },
    ],
    origins: [
      { id: "UK", label: "UK–Consort", freightExportFeesUsd: 0, oceanFreightUsd: null, marineInsurancePct: 1.5, portHandlingUsd: 50, dutyGctPct: 55, palletCount: 1 },
      { id: "USA", label: "USA–Miami", freightExportFeesUsd: 50, oceanFreightUsd: 200, marineInsurancePct: 1.5, brokerageUsdOverride: 0, portHandlingUsd: 150, dutyGctPct: 55, palletCount: 1 },
    ],
    fx,
    margin: { quoteMarginPct: 30 },
    params,
  };

  const r = calculateQuote(input);

  it("emits a zero_value_origin error and marks the UK origin skipped", () => {
    expect(r.errors.some((e) => e.code === "zero_value_origin" && e.originId === "UK")).toBe(true);
    const uk = r.origins.find((o) => o.originId === "UK")!;
    expect(uk.skipped).toBe(true);
  });

  it("still prices the Trudoor line and never leaks NaN/Infinity", () => {
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].lineId).toBe("trudoor");
    expect(Number.isFinite(r.totals.clientPriceUsd)).toBe(true);
    expect(Number.isFinite(r.totals.clientPriceJmd)).toBe(true);
  });
});

/**
 * Landed-cost calculation engine (Task 9) — PURE functions, no I/O.
 *
 * Implements Veridan_Build_Plan_v1.md §3.2 Steps 1–7 exactly, with the §7.1
 * resolutions baked in:
 *   - item 9: supplier FX rates are USD per 1 native unit → MULTIPLY.
 *   - item 2: $1,250 combined freight+insurance fallback applies only when
 *     itemized ocean freight is absent; it SUPERSEDES (replaces) both the
 *     itemized freight and the 1.5% marine-insurance formula — never added.
 *   - item 8: margin tier selected per quote, applied PER LINE
 *     (price = landed / (1 − margin/100)), per-line override allowed.
 *   - item 10 / §3.3 rounding: full precision through Steps 1–6; round only
 *     at final outputs (2dp USD half-up, whole-JMD per door); grand totals
 *     are sums of rounded components, never re-derived from unrounded sums.
 *
 * DECIMAL-ARITHMETIC CHOICE — native float64 + exponent-shift half-up rounding
 * (no decimal library, no integer-cents pipeline). Justification: every input
 * is a `numeric` with ≤4 decimal places and quote magnitudes are bounded by
 * numeric(14,2) (< 10^12). The pipeline is a handful of multiplies/divides per
 * line, so accumulated relative error stays within a few ULPs (~10^-12
 * relative, i.e. well under 10^-4 absolute at these magnitudes) — orders of
 * magnitude below the $0.005 threshold where 2dp rounding could flip. The one
 * genuine float hazard is the ROUNDING step itself (e.g. 1.005 is stored as
 * 1.00499999…), which `Math.round(x*100)/100` gets wrong; `roundHalfUp` below
 * avoids it by shifting the decimal point through the number's decimal string
 * representation ("1.005e2" → 100.5 exactly) instead of a binary multiply.
 * This keeps the engine dependency-free and trivially portable, and §3.3's
 * "sum of rounded components" totals rule removes any residual off-by-a-cent
 * risk at the quote level. If Task 25's parity run ever shows a cent-level
 * mismatch attributable to float error (it should not), swapping this module
 * onto decimal.js is a contained change: all arithmetic lives in this file.
 */

import type {
  AllocatedBreakdown,
  CurrencyCode,
  DoorRollup,
  EngineError,
  EngineParams,
  FxSnapshot,
  LineResult,
  MarginFlag,
  OriginCostInput,
  OriginResult,
  QuoteCalculationInput,
  QuoteCalculationResult,
  QuoteLineInput,
  QuoteTotals,
} from "./types";

// ---------------------------------------------------------------------------
// Rounding (§3.3)
// ---------------------------------------------------------------------------

/**
 * ROUND_HALF_UP (away from zero on the .5 boundary) at `dp` decimal places,
 * immune to binary-representation artifacts: the decimal shift happens in the
 * number's decimal string form, so 1.005 → "1.005e2" → 100.5 → 101 → 1.01.
 */
export function roundHalfUp(value: number, dp: number): number {
  if (!Number.isFinite(value)) return value;
  const negative = value < 0;
  const abs = Math.abs(value);
  const s = abs.toString();
  // String(x) is the shortest decimal round-trip form; appending the exponent
  // shifts the decimal point without a lossy binary multiply. Numbers whose
  // string form is already exponential (≥1e21 or <1e-7) are outside money
  // magnitudes — a plain multiply is fine there.
  const shifted = s.includes("e") ? abs * 10 ** dp : Number(`${s}e${dp}`);
  const rounded = Math.round(shifted);
  const result = rounded / 10 ** dp;
  return negative ? -result : result;
}

// ---------------------------------------------------------------------------
// Step 1 — currency normalization (§7.1 item 9: multiply)
// ---------------------------------------------------------------------------

/**
 * Convert a native-currency amount to USD via the quote's FX snapshot.
 * Rates are USD per 1 native unit → USD = native × rate. Returns null when
 * the snapshot has no rate for the currency (caller emits a structured error).
 */
export function toUsd(
  amount: number,
  currency: CurrencyCode,
  fx: FxSnapshot,
): number | null {
  if (currency === "USD") return amount;
  const rate = fx.supplierRates[currency];
  if (rate === undefined || rate === null) return null;
  return amount * rate;
}

// ---------------------------------------------------------------------------
// Step 7 — JMD conversion (computed once from the snapshot)
// ---------------------------------------------------------------------------

/** effective_rate = bank_sell_rate × (1 + fx_buffer_pct / 100). */
export function effectiveJmdRate(fx: FxSnapshot): number {
  return fx.bankSellRate * (1 + fx.fxBufferPct / 100);
}

// ---------------------------------------------------------------------------
// Step 3 helpers
// ---------------------------------------------------------------------------

/** brokerage = first + addl × max(palletCount − 1, 0). */
export function brokerageUsd(palletCount: number, params: EngineParams): number {
  return (
    params.brokerageFirstPalletUsd +
    params.brokerageAddlPalletUsd * Math.max(palletCount - 1, 0)
  );
}

interface OriginComputation {
  result: OriginResult;
  totalShipmentCostUsd: number;
  /** Shipment-cost component vector used for per-line breakdown allocation. */
  components: AllocatedBreakdown;
}

/**
 * Steps 2–3 for one origin. `supplierInvoiceTotalUsd` is the sum of member
 * lines' USD values (computed by the caller in Step 1/2).
 */
function computeOrigin(
  origin: OriginCostInput,
  supplierInvoiceTotalUsd: number,
  params: EngineParams,
): OriginComputation {
  // §7.1 item 2 — fallback semantics: when itemized ocean freight has not
  // been entered (null), the $1,250 parameter stands in for freight AND
  // insurance combined; the 1.5%-of-CIF insurance formula is superseded
  // (set to 0), never added on top.
  const usedFallbackFreight = origin.oceanFreightUsd === null;
  const oceanFreightAppliedUsd = usedFallbackFreight
    ? params.fallbackFreightInsuranceUsd
    : (origin.oceanFreightUsd as number);

  // Step 2 — CIF basis.
  const cifBasisUsd =
    supplierInvoiceTotalUsd + origin.freightExportFeesUsd + oceanFreightAppliedUsd;

  // Step 3 — shipment-level components.
  const marineInsuranceUsd = usedFallbackFreight
    ? 0
    : origin.marineInsuranceUsdOverride ??
      cifBasisUsd * (origin.marineInsurancePct / 100);
  const brokerage = origin.brokerageUsdOverride ?? brokerageUsd(origin.palletCount, params);
  const dutyGctUsd = cifBasisUsd * (origin.dutyGctPct / 100);

  const components: AllocatedBreakdown = {
    freightExportFeesUsd: origin.freightExportFeesUsd,
    oceanFreightUsd: oceanFreightAppliedUsd,
    marineInsuranceUsd,
    portHandlingUsd: origin.portHandlingUsd,
    brokerageUsd: brokerage,
    dutyGctUsd,
  };

  // Freight components appear both inside cifBasisUsd (the % base) and in the
  // total shipment adder — intentional per §3.2 Step 3 note; only the supplier
  // invoice value itself stays out of the adder.
  const totalShipmentCostUsd =
    components.freightExportFeesUsd +
    components.oceanFreightUsd +
    components.marineInsuranceUsd +
    components.portHandlingUsd +
    components.brokerageUsd +
    components.dutyGctUsd;

  return {
    result: {
      originId: origin.id,
      label: origin.label ?? null,
      supplierInvoiceTotalUsd,
      usedFallbackFreight,
      oceanFreightAppliedUsd,
      cifBasisUsd,
      freightExportFeesUsd: origin.freightExportFeesUsd,
      marineInsuranceUsd,
      brokerageUsd: brokerage,
      portHandlingUsd: origin.portHandlingUsd,
      dutyGctUsd,
      totalShipmentCostUsd,
      skipped: false,
    },
    totalShipmentCostUsd,
    components,
  };
}

// ---------------------------------------------------------------------------
// Step 6 — per-line margin + floor flags (§7.1 item 8, §6.3.4–5)
// ---------------------------------------------------------------------------

function priceLine(
  landedCostUsd: number,
  marginPct: number,
  params: EngineParams,
  lineId: string,
): { clientPriceUsd: number; flags: MarginFlag[] } {
  const clientPriceUsd = landedCostUsd / (1 - marginPct / 100);
  const flags: MarginFlag[] = [];
  const base = { lineId, marginPct, landedCostUsd, clientPriceUsd };

  if (clientPriceUsd < landedCostUsd) {
    // Quoting below the hard floor of landed cost itself.
    flags.push({ type: "price_below_landed_cost", ...base });
  }
  if (marginPct < params.marginFloorPct) {
    flags.push({ type: "margin_below_floor", ...base });
  } else if (
    params.marginTiersPct &&
    params.marginTiersPct.length > 0 &&
    !params.marginTiersPct.includes(marginPct)
  ) {
    flags.push({ type: "margin_below_tier", ...base });
  }
  return { clientPriceUsd, flags };
}

// ---------------------------------------------------------------------------
// Full pipeline — Steps 1–7
// ---------------------------------------------------------------------------

export function calculateQuote(
  input: QuoteCalculationInput,
): QuoteCalculationResult {
  const { lines, origins, fx, margin, params } = input;
  const errors: EngineError[] = [];
  const originById = new Map(origins.map((o) => [o.id, o]));

  // ---- Step 1: normalize every line to USD; collect FX/orphan errors. ----
  interface NormalizedLine {
    line: QuoteLineInput;
    unitCostUsd: number;
    lineValueUsd: number;
  }
  const normalized: NormalizedLine[] = [];
  const badFxLines = new Map<CurrencyCode, string[]>();
  const orphanLines: string[] = [];

  for (const line of lines) {
    if (!originById.has(line.originId)) {
      orphanLines.push(line.id);
      continue;
    }
    const unitCostUsd = toUsd(line.unitCost, line.costCurrency, fx);
    if (unitCostUsd === null) {
      const list = badFxLines.get(line.costCurrency) ?? [];
      list.push(line.id);
      badFxLines.set(line.costCurrency, list);
      continue;
    }
    normalized.push({
      line,
      unitCostUsd,
      lineValueUsd: line.qty * unitCostUsd,
    });
  }
  if (orphanLines.length > 0) {
    errors.push({
      code: "unknown_origin",
      lineIds: orphanLines,
      message: `Lines reference an origin id not present in the origins input: ${orphanLines.join(", ")}`,
    });
  }
  for (const [currency, lineIds] of badFxLines) {
    errors.push({
      code: "missing_fx_rate",
      currency,
      lineIds,
      message: `fx_snapshot.supplier_rates has no rate for ${currency}; lines excluded: ${lineIds.join(", ")}`,
    });
  }

  // ---- Step 2: supplier invoice total per origin. ----
  const linesByOrigin = new Map<string, NormalizedLine[]>();
  for (const n of normalized) {
    const list = linesByOrigin.get(n.line.originId) ?? [];
    list.push(n);
    linesByOrigin.set(n.line.originId, list);
  }

  const originResults: OriginResult[] = [];
  const lineResults: LineResult[] = [];
  const allFlags: MarginFlag[] = [];
  const effRate = effectiveJmdRate(fx);

  for (const origin of origins) {
    const members = linesByOrigin.get(origin.id) ?? [];
    if (members.length === 0) continue; // empty pool — nothing to allocate
    const supplierInvoiceTotalUsd = members.reduce(
      (sum, m) => sum + m.lineValueUsd,
      0,
    );

    // ---- Step 4 guard: zero-value origin → skip + structured error. ----
    if (supplierInvoiceTotalUsd === 0) {
      errors.push({
        code: "zero_value_origin",
        originId: origin.id,
        lineIds: members.map((m) => m.line.id),
        message: `Origin ${origin.label ?? origin.id} has a zero supplier invoice total; pro-rata allocation is undefined. Origin skipped.`,
      });
      originResults.push({
        originId: origin.id,
        label: origin.label ?? null,
        supplierInvoiceTotalUsd: 0,
        usedFallbackFreight: false,
        oceanFreightAppliedUsd: 0,
        cifBasisUsd: 0,
        freightExportFeesUsd: origin.freightExportFeesUsd,
        marineInsuranceUsd: 0,
        brokerageUsd: 0,
        portHandlingUsd: origin.portHandlingUsd,
        dutyGctUsd: 0,
        totalShipmentCostUsd: 0,
        skipped: true,
      });
      continue;
    }

    // ---- Steps 2–3: CIF basis + shipment components. ----
    const { result, totalShipmentCostUsd, components } = computeOrigin(
      origin,
      supplierInvoiceTotalUsd,
      params,
    );
    originResults.push(result);

    // ---- Steps 4 + 6 + 7 per member line. ----
    for (const m of members) {
      const allocationShare = m.lineValueUsd / supplierInvoiceTotalUsd;
      const allocatedShipmentCostUsd = totalShipmentCostUsd * allocationShare;
      const landedCostUsd = m.lineValueUsd + allocatedShipmentCostUsd;
      const marginPct = m.line.marginPctOverride ?? margin.quoteMarginPct;
      const { clientPriceUsd, flags } = priceLine(
        landedCostUsd,
        marginPct,
        params,
        m.line.id,
      );
      allFlags.push(...flags);
      const clientPriceJmd = clientPriceUsd * effRate;

      lineResults.push({
        lineId: m.line.id,
        originId: origin.id,
        productId: m.line.productId ?? null,
        doorId: m.line.doorId ?? null,
        hardwareSetId: m.line.hardwareSetId ?? null,
        qty: m.line.qty,
        unitCostUsd: m.unitCostUsd,
        lineValueUsd: m.lineValueUsd,
        allocationShare,
        allocatedShipmentCostUsd,
        allocatedBreakdown: {
          freightExportFeesUsd: components.freightExportFeesUsd * allocationShare,
          oceanFreightUsd: components.oceanFreightUsd * allocationShare,
          marineInsuranceUsd: components.marineInsuranceUsd * allocationShare,
          portHandlingUsd: components.portHandlingUsd * allocationShare,
          brokerageUsd: components.brokerageUsd * allocationShare,
          dutyGctUsd: components.dutyGctUsd * allocationShare,
        },
        landedCostUsd,
        marginPct,
        clientPriceUsd,
        clientPriceUsdRounded: roundHalfUp(clientPriceUsd, 2),
        clientPriceJmd,
        clientPriceJmdRounded: roundHalfUp(clientPriceJmd, 2),
        flags,
      });
    }
  }

  // ---- Step 5: per-door rollups (door_register mode). ----
  const doors: DoorRollup[] = [];
  if (input.mode === "door_register") {
    const byDoor = new Map<string, LineResult[]>();
    for (const lr of lineResults) {
      if (!lr.doorId) continue;
      const list = byDoor.get(lr.doorId) ?? [];
      list.push(lr);
      byDoor.set(lr.doorId, list);
    }
    for (const [doorId, doorLines] of byDoor) {
      // Full-precision sums, rounded once at the door level (§3.3).
      const landed = doorLines.reduce((s, l) => s + l.landedCostUsd, 0);
      const priceUsd = doorLines.reduce((s, l) => s + l.clientPriceUsd, 0);
      doors.push({
        doorId,
        hardwareSetId: doorLines[0].hardwareSetId,
        lineIds: doorLines.map((l) => l.lineId),
        landedCostUsd: roundHalfUp(landed, 2),
        clientPriceUsd: roundHalfUp(priceUsd, 2),
        // §3.3: per-door JMD rounds to the nearest whole dollar.
        clientPriceJmd: roundHalfUp(priceUsd * effRate, 0),
      });
    }
  }

  // ---- Totals (§3.3: grand total = sum of ROUNDED components). ----
  const landedTotal = lineResults.reduce((s, l) => s + l.landedCostUsd, 0);
  const clientUsdTotal = lineResults.reduce(
    (s, l) => s + l.clientPriceUsdRounded,
    0,
  );
  let clientJmdTotal: number;
  if (input.mode === "door_register") {
    const doorTotal = doors.reduce((s, d) => s + d.clientPriceJmd, 0);
    // Door-less lines (rare in this mode) still contribute at 2dp.
    const flatTotal = lineResults
      .filter((l) => !l.doorId)
      .reduce((s, l) => s + l.clientPriceJmdRounded, 0);
    clientJmdTotal = doorTotal + flatTotal;
  } else {
    clientJmdTotal = lineResults.reduce(
      (s, l) => s + l.clientPriceJmdRounded,
      0,
    );
  }

  const totals: QuoteTotals = {
    landedCostUsd: roundHalfUp(landedTotal, 2),
    // Components are already 2dp; the final round only clears float residue
    // from summation (e.g. 0.1+0.2 artifacts), it never changes a cent.
    clientPriceUsd: roundHalfUp(clientUsdTotal, 2),
    clientPriceJmd: roundHalfUp(clientJmdTotal, 2),
  };

  return {
    lines: lineResults,
    origins: originResults,
    doors,
    totals,
    effectiveJmdRate: effRate,
    flags: allFlags,
    requiresOverride: allFlags.length > 0,
    errors,
  };
}

/**
 * Landed-cost engine — input/output types (Task 9).
 *
 * Source of truth: Veridan_Build_Plan_v1.md §3 (algorithm Steps 1–7, §3.3
 * rounding) and §7.1 resolutions (items 2, 3, 8, 9, 10), plus PRD v3 §6.3/§7.
 *
 * These shapes map 1:1 onto the DB rows in
 * supabase/migrations/20260713000001_schema.sql (quotes.fx_snapshot /
 * parameters_snapshot jsonb, quote_origins, quote_line_items) so a caller can
 * hydrate inputs from the DB and persist outputs back, but the engine itself
 * is PURE — no Supabase imports, no I/O.
 */

export type CurrencyCode = "USD" | "CAD" | "GBP" | "EUR" | "JMD";

/** Mirrors quotes.quote_mode. Decides JMD rounding granularity (§3.3). */
export type QuoteMode = "door_register" | "line_item";

/**
 * Mirrors quotes.fx_snapshot jsonb.
 * supplierRates are stored as **USD per 1 unit of native currency** — the
 * conversion is a MULTIPLY (native × rate = USD), per §7.1 item 9 (workbook
 * convention, e.g. "CAD → USD 0.74", "GBP → USD 1.27").
 */
export interface FxSnapshot {
  /** CIBC Caribbean bank sell rate, USD→JMD (e.g. 162). */
  bankSellRate: number;
  /** FX risk buffer as a percentage, e.g. 3 for 3%. */
  fxBufferPct: number;
  /** USD per 1 native unit, keyed by ISO code. USD itself needs no entry. */
  supplierRates: Partial<Record<CurrencyCode, number>>;
}

/** One quote line (mirrors quote_line_items, pre-calculation). */
export interface QuoteLineInput {
  /** Caller-supplied stable id (quote_line_items.id or a temp key). */
  id: string;
  /** quote_line_items.product_id — carried through, not used in math. */
  productId?: string | null;
  /** quote_line_items.door_id — null in line_item mode. */
  doorId?: string | null;
  /** quote_line_items.hardware_set_id — for HW-group display grouping. */
  hardwareSetId?: string | null;
  /** quote_line_items.quote_origin_id — which shipment pool this line joins. */
  originId: string;
  qty: number;
  /** Unit cost in costCurrency (quote_line_items.unit_cost). */
  unitCost: number;
  costCurrency: CurrencyCode;
  /** Per-line margin override, % (§7.1 item 8 allows per-line override). */
  marginPctOverride?: number | null;
}

/**
 * One shipment origin's cost inputs (mirrors quote_origins).
 * All values USD unless stated. Defaults come from the quote's
 * parameters_snapshot — the CALLER resolves defaults; the engine only
 * interprets `null` where the spec assigns null a meaning (fallback freight).
 */
export interface OriginCostInput {
  id: string;
  /** e.g. "UK–Consort", "USA–Miami" — carried through to outputs. */
  label?: string;
  /** Origin-side freight/export fees. */
  freightExportFeesUsd: number;
  /**
   * Ocean freight. `null` = not yet entered → the $1,250 combined
   * freight+insurance planning fallback applies (§7.1 item 2), which
   * SUPERSEDES (replaces, never adds to) itemized freight + 1.5% insurance.
   */
  oceanFreightUsd: number | null;
  /** Marine insurance as % of CIF basis (default 1.5). */
  marineInsurancePct: number;
  /** Manual override of the computed insurance amount, if set. */
  marineInsuranceUsdOverride?: number | null;
  /** Drives brokerage formula: first + addl × max(palletCount − 1, 0). */
  palletCount: number;
  /** Manual override of the computed brokerage amount, if set. */
  brokerageUsdOverride?: number | null;
  /** Port storage/handling flat fee (parameter default $50, §7.1 item 3). */
  portHandlingUsd: number;
  /** Duty + GCT composite as % of CIF basis (default 55). */
  dutyGctPct: number;
}

/**
 * Margin selection (§7.1 item 8): one tier % selected per quote, applied
 * PER LINE ITEM; per-line overrides live on QuoteLineInput.marginPctOverride.
 */
export interface MarginInput {
  /** Selected quote-level margin %, e.g. 30 / 35 / 40. */
  quoteMarginPct: number;
}

/** Engine constants resolved from parameters_snapshot by the caller. */
export interface EngineParams {
  /** $1,250 combined freight+insurance planning fallback (§7.1 item 2). */
  fallbackFreightInsuranceUsd: number;
  /** $120 (brokerage, first pallet). */
  brokerageFirstPalletUsd: number;
  /** $50 (brokerage, each additional pallet). */
  brokerageAddlPalletUsd: number;
  /** Hard floor, % (20). Effective margin below this flags an override. */
  marginFloorPct: number;
  /** Optional tier list (e.g. [30,35,40]); enables margin_below_tier flag. */
  marginTiersPct?: number[];
}

export interface QuoteCalculationInput {
  mode: QuoteMode;
  lines: QuoteLineInput[];
  origins: OriginCostInput[];
  fx: FxSnapshot;
  margin: MarginInput;
  params: EngineParams;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** Matches override_log.override_type in the schema. */
export type MarginFlagType =
  | "margin_below_tier"
  | "margin_below_floor"
  | "price_below_landed_cost";

export interface MarginFlag {
  type: MarginFlagType;
  lineId: string;
  marginPct: number;
  landedCostUsd: number;
  clientPriceUsd: number;
}

/** Structured, non-throwing data errors (§3.2 Step 4 zero-value guard etc). */
export type EngineErrorCode =
  | "zero_value_origin"
  | "unknown_origin"
  | "missing_fx_rate";

export interface EngineError {
  code: EngineErrorCode;
  originId?: string;
  /** Lines excluded from the priced output because of this error. */
  lineIds: string[];
  currency?: CurrencyCode;
  message: string;
}

/** Per-line allocated shipment-cost breakdown by component (full precision). */
export interface AllocatedBreakdown {
  freightExportFeesUsd: number;
  oceanFreightUsd: number;
  marineInsuranceUsd: number;
  portHandlingUsd: number;
  brokerageUsd: number;
  dutyGctUsd: number;
}

export interface LineResult {
  lineId: string;
  originId: string;
  productId: string | null;
  doorId: string | null;
  hardwareSetId: string | null;
  qty: number;
  /** Step 1 — unit cost converted to USD (full precision). */
  unitCostUsd: number;
  /** Step 1 — qty × unitCostUsd (full precision). */
  lineValueUsd: number;
  /** Step 4 — lineValueUsd / origin supplier invoice total. */
  allocationShare: number;
  /** Step 4 — allocated share of the origin's total shipment cost. */
  allocatedShipmentCostUsd: number;
  allocatedBreakdown: AllocatedBreakdown;
  /** Step 4 — lineValueUsd + allocatedShipmentCostUsd (full precision). */
  landedCostUsd: number;
  /** Margin actually applied to this line (override or quote tier). */
  marginPct: number;
  /** Step 6 — landed / (1 − margin/100), full precision. */
  clientPriceUsd: number;
  /** §3.3 — clientPriceUsd rounded half-up to 2dp (display/persist value). */
  clientPriceUsdRounded: number;
  /** Step 7 — clientPriceUsd × effective rate, full precision. */
  clientPriceJmd: number;
  /** §3.3 — rounded half-up to 2dp (line_item-mode display value). */
  clientPriceJmdRounded: number;
  flags: MarginFlag[];
}

export interface OriginResult {
  originId: string;
  label: string | null;
  /** Step 2 — sum of member lines' lineValueUsd (full precision). */
  supplierInvoiceTotalUsd: number;
  /** True when the $1,250 fallback replaced itemized freight+insurance. */
  usedFallbackFreight: boolean;
  /** Ocean freight actually applied (itemized or fallback amount). */
  oceanFreightAppliedUsd: number;
  /** Step 2 — invoice + freight/export + ocean freight. */
  cifBasisUsd: number;
  /** Step 3 components (full precision). */
  freightExportFeesUsd: number;
  marineInsuranceUsd: number;
  brokerageUsd: number;
  portHandlingUsd: number;
  dutyGctUsd: number;
  totalShipmentCostUsd: number;
  /** True when the zero-value guard skipped this origin. */
  skipped: boolean;
}

/** Step 5 — per-door rollup (door_register mode). */
export interface DoorRollup {
  doorId: string;
  hardwareSetId: string | null;
  lineIds: string[];
  /** Sum of member lines' full-precision landed costs, rounded 2dp. */
  landedCostUsd: number;
  /** Sum of member lines' full-precision client prices, rounded 2dp. */
  clientPriceUsd: number;
  /** §3.3 — whole-JMD per door (rounded from the full-precision door USD). */
  clientPriceJmd: number;
}

export interface QuoteTotals {
  /** Sum of full-precision line landed costs, rounded 2dp (internal cache). */
  landedCostUsd: number;
  /** §3.3 — SUM OF ROUNDED per-line clientPriceUsdRounded (never re-derived). */
  clientPriceUsd: number;
  /**
   * §3.3 — sum of rounded components: whole-JMD per door in door_register
   * mode (plus 2dp for any door-less lines), 2dp per line in line_item mode.
   */
  clientPriceJmd: number;
}

export interface QuoteCalculationResult {
  lines: LineResult[];
  origins: OriginResult[];
  /** Present (possibly empty) in door_register mode. */
  doors: DoorRollup[];
  totals: QuoteTotals;
  /** bankSellRate × (1 + fxBufferPct/100), computed once from the snapshot. */
  effectiveJmdRate: number;
  /** All margin/floor flags across lines. Non-empty ⇒ override required. */
  flags: MarginFlag[];
  /**
   * True when any flag requires an override_log row before save (§6.3.4–5).
   * Persisting the override is the CALLER's job — the engine only flags.
   */
  requiresOverride: boolean;
  /** Structured data errors (zero-value origins etc). Engine never throws. */
  errors: EngineError[];
}

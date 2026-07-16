/**
 * Quote snapshot builders + parsers (Task 16) — PURE, no Supabase client.
 *
 * These turn the LIVE `business_parameters` rows into the frozen
 * `quotes.parameters_snapshot` / `quotes.fx_snapshot` jsonb blobs at quote
 * creation, and read those blobs back into typed shapes for the landed-cost
 * engine. The snapshot is what makes "editing a parameter never rewrites a
 * created quote" true (§1.7): once built, the engine reads only the snapshot,
 * never the live table.
 *
 * Kept dependency-free (mirrors lib/landed-cost/engine.ts, lib/doors.ts,
 * lib/hardware-sets.ts) so it's unit-testable in isolation.
 */

import type { FxSnapshot } from "@/lib/landed-cost/types";
import type {
  BusinessParameterRow,
  CurrencyCode,
  FxSnapshotStored,
  ParametersSnapshotStored,
} from "@/lib/supabase/types";
import type { EngineParams } from "@/lib/landed-cost/types";

/** Reads one parameter's typed payload out of a key→row map. */
function paramValue(
  rows: Map<string, BusinessParameterRow>,
  key: string,
): unknown {
  const row = rows.get(key);
  return row?.value?.value;
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Builds the frozen parameters snapshot from the live business_parameters
 * rows. Every field the engine or the quote document reads is copied by
 * value; anything missing falls back to the PRD §7 / §7.1 seed default so a
 * partially-seeded environment still produces a coherent quote rather than
 * NaN. Keyed defaults match supabase/migrations/20260713000003_seed_parameters.sql.
 */
export function buildParametersSnapshot(
  paramRows: BusinessParameterRow[],
): ParametersSnapshotStored {
  const rows = new Map(paramRows.map((r) => [r.key, r]));

  const marginTiersRaw = paramValue(rows, "margin_tiers");
  const marginTiers = Array.isArray(marginTiersRaw)
    ? marginTiersRaw.map((n) => num(n, NaN)).filter((n) => Number.isFinite(n))
    : [30, 35, 40];

  const leadTimesRaw = paramValue(rows, "lead_times");
  const leadTimes =
    leadTimesRaw && typeof leadTimesRaw === "object"
      ? (leadTimesRaw as Record<string, string>)
      : {};

  const companyRaw = paramValue(rows, "company_details");
  const companyDetails =
    companyRaw && typeof companyRaw === "object"
      ? (companyRaw as Record<string, string>)
      : {};

  return {
    duty_gct_pct: num(paramValue(rows, "duty_gct_pct"), 55),
    marine_insurance_pct: num(paramValue(rows, "marine_insurance_pct"), 1.5),
    brokerage_first_pallet_usd: num(paramValue(rows, "brokerage_first_pallet_usd"), 120),
    brokerage_addl_pallet_usd: num(paramValue(rows, "brokerage_addl_pallet_usd"), 50),
    port_handling_usd: num(paramValue(rows, "port_handling_usd"), 50),
    freight_insurance_fallback_usd: num(paramValue(rows, "freight_insurance_fallback_usd"), 1250),
    procurement_handling_fee_usd: num(paramValue(rows, "procurement_handling_fee_usd"), 500),
    contingency_pct: num(paramValue(rows, "contingency_pct"), 5),
    margin_tiers: marginTiers.length > 0 ? marginTiers : [30, 35, 40],
    margin_floor_pct: num(paramValue(rows, "margin_floor_pct"), 20),
    min_order_value_usd: num(paramValue(rows, "min_order_value_usd"), 2000),
    deposit_standard_pct: num(paramValue(rows, "deposit_standard_pct"), 60),
    quote_validity_days: num(paramValue(rows, "quote_validity_days"), 15),
    default_finish: str(paramValue(rows, "default_finish"), "Satin Stainless Steel (US32D)"),
    gct_enabled: bool(paramValue(rows, "gct_enabled"), false),
    gct_rate_pct: num(paramValue(rows, "gct_rate_pct"), 15),
    lead_times: leadTimes,
    company_details: companyDetails,
  };
}

/**
 * Builds the frozen FX snapshot (§1.7). `effective_rate` is precomputed and
 * stored alongside the raw inputs so the document layer never has to re-derive
 * it (and can render "162.00 × 1.03 = 166.86" transparently). `asOf` defaults
 * to today's date; callers pass the quote_date to keep them aligned.
 */
export function buildFxSnapshot(
  paramRows: BusinessParameterRow[],
  asOf: string,
): FxSnapshotStored {
  const rows = new Map(paramRows.map((r) => [r.key, r]));

  const bankSellRate = num(paramValue(rows, "fx_bank_sell_rate_usd_jmd"), 162);
  const fxBufferPct = num(paramValue(rows, "fx_risk_buffer_pct"), 3);

  const ratesRaw = paramValue(rows, "supplier_fx_rates");
  const supplierRates: Partial<Record<CurrencyCode, number>> =
    ratesRaw && typeof ratesRaw === "object"
      ? (ratesRaw as Partial<Record<CurrencyCode, number>>)
      : { USD: 1 };

  return {
    bank_sell_rate: bankSellRate,
    fx_buffer_pct: fxBufferPct,
    effective_rate: bankSellRate * (1 + fxBufferPct / 100),
    supplier_rates: supplierRates,
    source: "manual admin entry",
    as_of: asOf,
  };
}

// ---------------------------------------------------------------------------
// Snapshot → engine input adapters (read side)
// ---------------------------------------------------------------------------

/** Maps the frozen parameters snapshot to the engine's constants. */
export function snapshotToEngineParams(p: ParametersSnapshotStored): EngineParams {
  return {
    fallbackFreightInsuranceUsd: p.freight_insurance_fallback_usd,
    brokerageFirstPalletUsd: p.brokerage_first_pallet_usd,
    brokerageAddlPalletUsd: p.brokerage_addl_pallet_usd,
    marginFloorPct: p.margin_floor_pct,
    marginTiersPct: p.margin_tiers,
  };
}

/** Maps the frozen FX snapshot to the engine's FxSnapshot input. */
export function fxSnapshotToEngine(fx: FxSnapshotStored): FxSnapshot {
  return {
    bankSellRate: fx.bank_sell_rate,
    fxBufferPct: fx.fx_buffer_pct,
    supplierRates: fx.supplier_rates,
  };
}

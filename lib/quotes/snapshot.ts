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

// ---------------------------------------------------------------------------
// Required inputs — an incomplete read is a HARD ERROR, never a default
//
// Security review 2026-08-08, BLOCKER-3. These builders used to fall back to the
// PRD §7 seed defaults for any key they could not find, which reads as
// defensive but is the opposite: the result is FROZEN into
// quotes.parameters_snapshot / fx_snapshot and is what the quote is priced from
// for the rest of its life. So a read that returned nothing produced a quote
// silently priced at hard-coded duty/FX/margin numbers, with no error anywhere.
//
// That is not hypothetical. Under RLS an unauthorised SELECT returns ZERO ROWS
// WITH `error === null`, so `if (error) return …` guards pass happily; and even
// for a founder a transient failure would freeze the wrong rates permanently.
// A missing parameter is now refused: better a quote that fails to be created
// than a quote that is quietly wrong forever.
//
// Keep these lists in step with public.snapshot_business_parameters()
// (supabase/migrations/20260807000004_user_roles.sql §7) and the seed in
// 20260713000003_seed_parameters.sql.
// ---------------------------------------------------------------------------

/** Keys `buildParametersSnapshot` must have to produce a trustworthy snapshot. */
export const SNAPSHOT_PARAMETER_KEYS = [
  "duty_gct_pct",
  "marine_insurance_pct",
  "brokerage_first_pallet_usd",
  "brokerage_addl_pallet_usd",
  "port_handling_usd",
  "freight_insurance_fallback_usd",
  "procurement_handling_fee_usd",
  "contingency_pct",
  "margin_tiers",
  "margin_floor_pct",
  "min_order_value_usd",
  "deposit_standard_pct",
  "quote_validity_days",
  "default_finish",
  "gct_enabled",
  "gct_rate_pct",
  "lead_times",
  "company_details",
] as const;

/** Keys `buildFxSnapshot` must have. */
export const SNAPSHOT_FX_KEYS = [
  "fx_bank_sell_rate_usd_jmd",
  "fx_risk_buffer_pct",
  "supplier_fx_rates",
] as const;

/** Everything public.snapshot_business_parameters() is expected to return. */
export const ALL_SNAPSHOT_KEYS: readonly string[] = [
  ...SNAPSHOT_PARAMETER_KEYS,
  ...SNAPSHOT_FX_KEYS,
];

/**
 * Thrown instead of silently substituting a default. Carries the missing keys
 * so the caller's message can name them rather than saying "something failed".
 */
export class MissingBusinessParametersError extends Error {
  readonly missingKeys: readonly string[];
  readonly rowsSeen: number;

  constructor(what: string, missingKeys: readonly string[], rowsSeen: number) {
    super(
      `Cannot freeze this quote's ${what}: ${missingKeys.length} business parameter(s) missing ` +
        `(${missingKeys.join(", ")}) — ${rowsSeen} row(s) were read. Refusing rather than ` +
        `substituting seed defaults, because a wrong rate frozen into a quote is permanent. ` +
        `Usual causes: 20260713000003_seed_parameters.sql has not been applied, or row-level ` +
        `security returned zero rows (business_parameters is founder-only — non-founder reads ` +
        `must go through public.snapshot_business_parameters()).`
    );
    this.name = "MissingBusinessParametersError";
    this.missingKeys = missingKeys;
    this.rowsSeen = rowsSeen;
  }
}

/**
 * A key counts as present only when it has an actual payload — a row whose
 * `value.value` is null/undefined would fall through to the same default this
 * guard exists to prevent.
 */
function assertKeysPresent(
  rows: Map<string, BusinessParameterRow>,
  requiredKeys: readonly string[],
  what: string,
): void {
  const missing = requiredKeys.filter((key) => rows.get(key)?.value?.value == null);
  if (missing.length > 0) {
    throw new MissingBusinessParametersError(what, missing, rows.size);
  }
}

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
 * rows. Every field the engine or the quote document reads is copied by value.
 *
 * THROWS `MissingBusinessParametersError` if any of SNAPSHOT_PARAMETER_KEYS is
 * absent (see the block above). The literal defaults below therefore only ever
 * apply to a value that is present but of the wrong SHAPE (e.g. `margin_tiers`
 * stored as something other than an array) — they are no longer reachable by an
 * empty or short read, which is the case that produced silently mispriced
 * quotes. Keyed defaults match supabase/migrations/20260713000003_seed_parameters.sql.
 */
export function buildParametersSnapshot(
  paramRows: BusinessParameterRow[],
): ParametersSnapshotStored {
  const rows = new Map(paramRows.map((r) => [r.key, r]));
  assertKeysPresent(rows, SNAPSHOT_PARAMETER_KEYS, "pricing parameters snapshot");

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
 *
 * THROWS `MissingBusinessParametersError` if any of SNAPSHOT_FX_KEYS is absent.
 * The old behaviour — falling back to 162 JMD/USD and a 3% buffer — meant a
 * failed or RLS-denied read produced a quote priced at a rate nobody chose, and
 * FX is the single most time-sensitive input in the whole model.
 */
export function buildFxSnapshot(
  paramRows: BusinessParameterRow[],
  asOf: string,
): FxSnapshotStored {
  const rows = new Map(paramRows.map((r) => [r.key, r]));
  assertKeysPresent(rows, SNAPSHOT_FX_KEYS, "FX snapshot");

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

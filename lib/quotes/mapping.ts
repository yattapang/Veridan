/**
 * Quote DB-rows ⇄ landed-cost engine mapping (Task 16) — PURE, no Supabase
 * client. This is the seam between the persisted quote (rows in quotes,
 * quote_origins, quote_line_items) and the pure engine (lib/landed-cost).
 * The builder's server actions hydrate inputs here, run the engine, then
 * persist the outputs — no calculation lives in the UI or the actions.
 *
 * Kept dependency-free and unit-tested (mapping.test.ts) per the brief:
 * origin grouping, ref generation, and the immutability of a quote's numbers
 * against later parameter edits are all asserted here.
 */

import type {
  OriginCostInput,
  QuoteCalculationInput,
  QuoteCalculationResult,
  QuoteLineInput,
  QuoteMode,
} from "@/lib/landed-cost/types";
import type {
  FxSnapshotStored,
  ParametersSnapshotStored,
  QuoteLineItemRow,
  QuoteOriginRow,
  QuoteRow,
} from "@/lib/supabase/types";
import { calculateQuote } from "../landed-cost/engine";
import { fxSnapshotToEngine, snapshotToEngineParams } from "./snapshot";

// ---------------------------------------------------------------------------
// Quote reference generation (VQ-YYYY-NNN, sequential per year)
// ---------------------------------------------------------------------------

/**
 * Next human-facing quote ref for `year`, given the refs already used that
 * year. Format is `VQ-YYYY-NNN` (3-digit zero-padded sequence) — the schema
 * (§1.7) only requires `quote_ref` be unique and "sequential per year", so
 * this is the chosen convention. Only refs matching this exact pattern for
 * the given year count toward the sequence; anything else is ignored so a
 * hand-entered odd ref never breaks the counter. The unique constraint on
 * quotes.quote_ref is the final backstop against a two-tab race.
 */
export function nextQuoteRef(year: number, existingRefs: string[]): string {
  const pattern = new RegExp(`^VQ-${year}-(\\d+)$`);
  let max = 0;
  for (const ref of existingRefs) {
    const m = pattern.exec(ref.trim());
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `VQ-${year}-${String(max + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Origin grouping (default shipment pools from the suppliers used)
// ---------------------------------------------------------------------------

export interface SupplierOriginFields {
  id: string;
  origin_region: string | null;
  country: string | null;
}

/**
 * The origin-pool key for one supplier (§1.8 keys pools by a text
 * `origin_label`). Preference order:
 *   1. `origin_region` — the field §1.1 exists specifically to "group
 *      suppliers into shipment origins per §6.3" (e.g. "UK–Consort").
 *   2. `country` — a sensible fallback when no region grouping is set.
 *   3. "Other" — the PRD's catch-all origin (§6.3.1) for anything unkeyed.
 * The key doubles as the origin_label so pools read naturally on the quote
 * ("UK–Consort", "USA", "Other").
 */
export function supplierOriginKey(s: SupplierOriginFields): string {
  const region = s.origin_region?.trim();
  if (region) return region;
  const country = s.country?.trim();
  if (country) return country;
  return "Other";
}

export interface OriginGroup {
  /** origin_label for the quote_origins row. */
  label: string;
  /** Supplier ids that fall into this pool. */
  supplierIds: string[];
}

/**
 * Groups the distinct suppliers used on a quote into default shipment pools:
 * one pool per `supplierOriginKey`. Returns pools sorted by label for stable
 * ordering. A supplier with no region/country lands in the "Other" pool
 * rather than being dropped.
 */
export function buildOriginGroups(suppliers: SupplierOriginFields[]): OriginGroup[] {
  const byKey = new Map<string, Set<string>>();
  for (const s of suppliers) {
    const key = supplierOriginKey(s);
    const set = byKey.get(key) ?? new Set<string>();
    set.add(s.id);
    byKey.set(key, set);
  }
  return [...byKey.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, ids]) => ({ label, supplierIds: [...ids] }));
}

/**
 * Builds a supplier-id → origin-label lookup from the grouped pools, so each
 * materialized quote line can be assigned to the right pool by its line's
 * supplier. A supplier not present in any group maps to "Other" (defensive;
 * buildOriginGroups always places every supplier somewhere).
 */
export function supplierOriginLabelMap(groups: OriginGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of groups) {
    for (const id of g.supplierIds) map.set(id, g.label);
  }
  return map;
}

// ---------------------------------------------------------------------------
// DB row → engine input adapters
// ---------------------------------------------------------------------------

function toNum(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * Maps a persisted quote_origins row + the quote's parameters snapshot to the
 * engine's OriginCostInput. Columns that are null fall back to the frozen
 * snapshot default (duty %, port handling) or to the engine's own null
 * semantics (ocean freight null → $1,250 fallback; brokerage/insurance null →
 * engine computes them from pallet count / CIF %). The marine-insurance
 * PERCENT is not a per-origin column — it comes from the snapshot — while the
 * marine_insurance_usd column, when set, is the amount OVERRIDE.
 */
export function originRowToInput(
  row: QuoteOriginRow,
  snapshot: ParametersSnapshotStored,
): OriginCostInput {
  return {
    id: row.id,
    label: row.origin_label,
    freightExportFeesUsd: toNum(row.freight_export_fees_usd) ?? 0,
    oceanFreightUsd: toNum(row.ocean_freight_usd),
    marineInsurancePct: snapshot.marine_insurance_pct,
    marineInsuranceUsdOverride: toNum(row.marine_insurance_usd),
    palletCount: toNum(row.pallet_count) ?? 1,
    brokerageUsdOverride: toNum(row.brokerage_usd),
    portHandlingUsd: toNum(row.port_handling_usd) ?? snapshot.port_handling_usd,
    dutyGctPct: toNum(row.duty_gct_pct) ?? snapshot.duty_gct_pct,
  };
}

/** Maps a persisted quote_line_items row to the engine's QuoteLineInput. */
export function lineRowToInput(row: QuoteLineItemRow): QuoteLineInput {
  return {
    id: row.id,
    productId: row.product_id,
    doorId: row.door_id,
    hardwareSetId: row.hardware_set_id,
    originId: row.quote_origin_id,
    qty: toNum(row.qty) ?? 0,
    unitCost: toNum(row.unit_cost) ?? 0,
    costCurrency: row.cost_currency,
    marginPctOverride: toNum(row.margin_pct_override),
  };
}

/**
 * Assembles the full engine input from a quote's persisted state. FX and
 * engine params come exclusively from the quote's OWN frozen snapshots
 * (never the live business_parameters table), which is what makes a created
 * quote's numbers immune to later parameter edits. The quote-level margin
 * tier comes from `quoteMarginPct`; per-line overrides ride on each line row.
 */
export function buildQuoteCalculationInput(args: {
  mode: QuoteMode;
  quoteMarginPct: number;
  parametersSnapshot: ParametersSnapshotStored;
  fxSnapshot: FxSnapshotStored;
  origins: QuoteOriginRow[];
  lines: QuoteLineItemRow[];
}): QuoteCalculationInput {
  return {
    mode: args.mode,
    lines: args.lines.map(lineRowToInput),
    origins: args.origins.map((o) => originRowToInput(o, args.parametersSnapshot)),
    fx: fxSnapshotToEngine(args.fxSnapshot),
    margin: { quoteMarginPct: args.quoteMarginPct },
    params: snapshotToEngineParams(args.parametersSnapshot),
  };
}

/** A quote's full persisted state, as loaded from the three quote tables. */
export interface QuoteState {
  quote: QuoteRow;
  origins: QuoteOriginRow[];
  lines: QuoteLineItemRow[];
}

/**
 * Runs the engine over a quote's persisted state (reading only its frozen
 * snapshots). Pure: no I/O. Callers can pass a state whose in-memory margin
 * tier / per-line overrides differ from the DB to PREVIEW a not-yet-saved
 * change — this is how the margin gate checks floor breaches before deciding
 * whether a save is allowed (§6.3.5).
 */
export function computeQuoteResult(state: QuoteState): QuoteCalculationResult {
  return calculateQuote(
    buildQuoteCalculationInput({
      mode: state.quote.quote_mode,
      quoteMarginPct: state.quote.margin_pct,
      parametersSnapshot: state.quote.parameters_snapshot,
      fxSnapshot: state.quote.fx_snapshot,
      origins: state.origins,
      lines: state.lines,
    }),
  );
}

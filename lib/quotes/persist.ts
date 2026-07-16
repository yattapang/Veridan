/**
 * Quote recompute + persistence (Task 16) — server-side glue between the
 * pure engine (via lib/quotes/mapping) and the three quote tables. This is
 * the ONLY place engine outputs are written back to the DB, so the "no
 * client-side calc, recompute after every edit" rule (§3, brief) has a single
 * home. It takes a Supabase client as a parameter (rather than importing the
 * request-bound server client) so it stays decoupled and reusable from both
 * the create-quote action and the quote-editor actions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuoteCalculationResult } from "@/lib/landed-cost/types";
import { roundHalfUp } from "@/lib/landed-cost/engine";
import type {
  QuoteLineItemRow,
  QuoteOriginRow,
  QuoteRow,
} from "@/lib/supabase/types";
import { computeQuoteResult, type QuoteState } from "./mapping";

// A loosely-typed client is fine here — this repo has no generated DB types
// yet (see lib/supabase/types.ts header), matching the pattern used across
// the admin actions.
type Client = SupabaseClient;

/** Loads a quote's full persisted state (quote + origins + lines). */
export async function loadQuoteState(
  supabase: Client,
  quoteId: string,
): Promise<{ state: QuoteState | null; error: string | null }> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) return { state: null, error: quoteError.message };
  if (!quote) return { state: null, error: null };

  const [originsResult, linesResult] = await Promise.all([
    supabase.from("quote_origins").select("*").eq("quote_id", quoteId).order("origin_label"),
    supabase.from("quote_line_items").select("*").eq("quote_id", quoteId).order("sort_order"),
  ]);

  if (originsResult.error) return { state: null, error: originsResult.error.message };
  if (linesResult.error) return { state: null, error: linesResult.error.message };

  return {
    state: {
      quote: quote as QuoteRow,
      origins: (originsResult.data as QuoteOriginRow[]) ?? [],
      lines: (linesResult.data as QuoteLineItemRow[]) ?? [],
    },
    error: null,
  };
}

/**
 * Writes engine outputs back to the DB: per-line landed/allocated/USD-value
 * caches, per-origin CIF/shipment-total caches, and the quote's cached grand
 * totals. It deliberately does NOT overwrite the editable brokerage /
 * marine-insurance / freight columns — those hold the user's inputs (null =
 * "let the engine compute it"), so writing the computed value back would
 * silently convert a formula default into a frozen override.
 *
 * Money columns are rounded to their DB scale (numeric(14,2) → 2dp;
 * unit_cost_usd numeric(12,4) → 4dp) using the engine's half-up rounder so
 * the stored cache matches what the document renders.
 */
export async function persistComputed(
  supabase: Client,
  quote: QuoteRow,
  result: QuoteCalculationResult,
): Promise<{ error: string | null }> {
  const lineUpdates = result.lines.map((l) =>
    supabase
      .from("quote_line_items")
      .update({
        unit_cost_usd: roundHalfUp(l.unitCostUsd, 4),
        line_value_usd: roundHalfUp(l.lineValueUsd, 2),
        allocated_shipment_cost_usd: roundHalfUp(l.allocatedShipmentCostUsd, 2),
        landed_cost_usd: roundHalfUp(l.landedCostUsd, 2),
      })
      .eq("id", l.lineId),
  );

  const originUpdates = result.origins.map((o) =>
    supabase
      .from("quote_origins")
      .update({
        supplier_invoice_total: roundHalfUp(o.supplierInvoiceTotalUsd, 2),
        cif_basis_usd: roundHalfUp(o.cifBasisUsd, 2),
        total_shipment_cost_usd: roundHalfUp(o.totalShipmentCostUsd, 2),
      })
      .eq("id", o.originId),
  );

  const results = await Promise.all([...lineUpdates, ...originUpdates]);
  const firstError = results.find((r) => r.error);
  if (firstError?.error) {
    return { error: `Could not persist computed line/origin values: ${firstError.error.message}` };
  }

  const { error: totalsError } = await supabase
    .from("quotes")
    .update({
      total_landed_usd: result.totals.landedCostUsd,
      total_client_usd: result.totals.clientPriceUsd,
      total_client_jmd: result.totals.clientPriceJmd,
    })
    .eq("id", quote.id);

  if (totalsError) {
    return { error: `Could not persist quote totals: ${totalsError.message}` };
  }

  return { error: null };
}

/**
 * Loads a quote, runs the engine over its frozen snapshots, and persists all
 * computed caches. Returns the engine result (for flag inspection) and the
 * loaded state. Callers that need to gate on margin flags BEFORE saving
 * should instead load state, mutate it in memory, and call computeQuoteResult
 * directly (see the margin action) — this helper always persists.
 */
export async function recomputeQuote(
  supabase: Client,
  quoteId: string,
): Promise<{ result: QuoteCalculationResult | null; state: QuoteState | null; error: string | null }> {
  const { state, error } = await loadQuoteState(supabase, quoteId);
  if (error) return { result: null, state: null, error };
  if (!state) return { result: null, state: null, error: "Quote not found." };

  const result = computeQuoteResult(state);
  const { error: persistError } = await persistComputed(supabase, state.quote, result);
  if (persistError) return { result, state, error: persistError };

  return { result, state, error: null };
}

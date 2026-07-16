"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type {
  BusinessParameterRow,
  MarginFlagSummary,
} from "@/lib/supabase/types";
import { buildFxSnapshot } from "@/lib/quotes/snapshot";
import { computeQuoteResult } from "@/lib/quotes/mapping";
import { loadQuoteState, persistComputed, recomputeQuote } from "@/lib/quotes/persist";
import type { MarginFlag } from "@/lib/landed-cost/types";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type OriginActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export const initialOriginActionResult: OriginActionResult = { ok: true };

export type MarginActionResult =
  | { ok: true; requiresOverride?: false; error?: undefined; flags?: undefined }
  | { ok: false; requiresOverride: true; error: string; flags: MarginFlagSummary[] }
  | { ok: false; requiresOverride?: false; error: string; flags?: undefined };

export const initialMarginActionResult: MarginActionResult = { ok: true };

export type FxActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export const initialFxActionResult: FxActionResult = { ok: true };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parses an optional non-negative number field; blank → null. */
function optionalNonNegative(formData: FormData, key: string): { value: number | null } | { error: string } {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { error: `Enter a valid non-negative number for ${key}, or leave it blank.` };
  return { value: n };
}

/** Collapses per-line engine flags into a compact, de-duplicated summary. */
function summarizeFlags(flags: MarginFlag[]): MarginFlagSummary[] {
  const byType = new Map<string, MarginFlagSummary>();
  for (const f of flags) {
    const existing = byType.get(f.type);
    if (existing) {
      existing.lineCount += 1;
      existing.minMarginPct = Math.min(existing.minMarginPct, f.marginPct);
    } else {
      byType.set(f.type, {
        type: f.type,
        lineCount: 1,
        minMarginPct: f.marginPct,
        landedCostUsd: f.landedCostUsd,
        clientPriceUsd: f.clientPriceUsd,
      });
    }
  }
  return [...byType.values()];
}

// ---------------------------------------------------------------------------
// Origin cost-pool edits
// ---------------------------------------------------------------------------

/**
 * Updates one shipment origin's cost inputs (freight, insurance, port,
 * brokerage, duty, pallets), then recomputes + persists. Draft-only.
 * Blank numeric fields are stored as NULL so the engine applies its own
 * default (ocean freight → $1,250 fallback; brokerage → formula; insurance →
 * 1.5% of CIF; port/duty → snapshot defaults) rather than a frozen zero.
 */
export async function updateQuoteOrigin(
  quoteId: string,
  originId: string,
  _prevState: OriginActionResult,
  formData: FormData
): Promise<OriginActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, status")
    .eq("id", quoteId)
    .maybeSingle();
  if (quoteError) return { ok: false, error: `Could not load the quote: ${quoteError.message}` };
  if (!quote) return { ok: false, error: "Quote not found." };
  if (quote.status !== "draft") return { ok: false, error: "Only draft quotes can be edited." };

  const freight = optionalNonNegative(formData, "freight_export_fees_usd");
  const ocean = optionalNonNegative(formData, "ocean_freight_usd");
  const insurance = optionalNonNegative(formData, "marine_insurance_usd");
  const port = optionalNonNegative(formData, "port_handling_usd");
  const brokerage = optionalNonNegative(formData, "brokerage_usd");
  const duty = optionalNonNegative(formData, "duty_gct_pct");
  for (const r of [freight, ocean, insurance, port, brokerage, duty]) {
    if ("error" in r) return { ok: false, error: r.error };
  }

  const palletRaw = String(formData.get("pallet_count") ?? "").trim();
  const palletCount = Number(palletRaw);
  if (!Number.isInteger(palletCount) || palletCount < 1) {
    return { ok: false, error: "Pallet count must be a whole number of 1 or more." };
  }
  if ("value" in duty && duty.value !== null && duty.value > 100) {
    return { ok: false, error: "Duty + GCT % should be a percentage (0–100)." };
  }

  const { error: updateError } = await supabase
    .from("quote_origins")
    .update({
      freight_export_fees_usd: (freight as { value: number | null }).value ?? 0,
      ocean_freight_usd: (ocean as { value: number | null }).value,
      marine_insurance_usd: (insurance as { value: number | null }).value,
      port_handling_usd: (port as { value: number | null }).value,
      brokerage_usd: (brokerage as { value: number | null }).value,
      pallet_count: palletCount,
      duty_gct_pct: (duty as { value: number | null }).value,
    })
    .eq("id", originId)
    .eq("quote_id", quoteId);
  if (updateError) return { ok: false, error: `Could not save the origin: ${updateError.message}` };

  const { error: computeError } = await recomputeQuote(supabase, quoteId);
  if (computeError) return { ok: false, error: computeError };

  revalidatePath(`/admin/quotes/${quoteId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Margin selection + floor/override gate (§6.3.5)
// ---------------------------------------------------------------------------

/**
 * Applies the selected margin tier + optional per-line overrides. This is the
 * real §6.3.5 gate: the prospective margin is run through the engine IN MEMORY
 * before anything is saved. If it puts any line below the 20% floor / below
 * landed cost (or below the tier list) AND no override reason was supplied,
 * NOTHING is persisted and the action returns the flags so the UI can capture
 * a reason. Re-submitting with a reason writes the margin, recomputes, and
 * logs one override_log row per distinct breach type (who + reason, visible to
 * both founders).
 */
export async function updateQuoteMargin(
  quoteId: string,
  _prevState: MarginActionResult,
  formData: FormData
): Promise<MarginActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to change pricing." };

  const marginRaw = String(formData.get("margin_pct") ?? "").trim();
  const marginPct = Number(marginRaw);
  if (!Number.isFinite(marginPct)) return { ok: false, error: "Choose a valid margin." };

  const reason = String(formData.get("override_reason") ?? "").trim();

  const { state, error } = await loadQuoteState(supabase, quoteId);
  if (error) return { ok: false, error };
  if (!state) return { ok: false, error: "Quote not found." };
  if (state.quote.status !== "draft") return { ok: false, error: "Only draft quotes can be edited." };

  // Parse per-line overrides: fields named margin_override__<lineId>.
  const overrideByLine = new Map<string, number | null>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("margin_override__")) continue;
    const lineId = key.slice("margin_override__".length);
    const raw = String(value).trim();
    if (raw === "") {
      overrideByLine.set(lineId, null);
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return { ok: false, error: "Per-line margin overrides must be numbers." };
    overrideByLine.set(lineId, n);
  }

  // Build the prospective (not-yet-saved) state and run the engine.
  const prospective = {
    quote: { ...state.quote, margin_pct: marginPct },
    origins: state.origins,
    lines: state.lines.map((l) =>
      overrideByLine.has(l.id) ? { ...l, margin_pct_override: overrideByLine.get(l.id)! } : l
    ),
  };
  const result = computeQuoteResult(prospective);

  if (result.requiresOverride && !reason) {
    return {
      ok: false,
      requiresOverride: true,
      error: "This pricing breaches the margin floor. Enter a reason to override, or raise the margin.",
      flags: summarizeFlags(result.flags),
    };
  }

  // Persist the margin selection + per-line overrides.
  const { error: quoteUpdateError } = await supabase
    .from("quotes")
    .update({ margin_pct: marginPct, margin_override_reason: reason || null })
    .eq("id", quoteId);
  if (quoteUpdateError) return { ok: false, error: `Could not save the margin: ${quoteUpdateError.message}` };

  const lineUpdates = [...overrideByLine.entries()].map(([lineId, value]) =>
    supabase.from("quote_line_items").update({ margin_pct_override: value }).eq("id", lineId).eq("quote_id", quoteId)
  );
  const lineResults = await Promise.all(lineUpdates);
  const lineErr = lineResults.find((r) => r.error);
  if (lineErr?.error) return { ok: false, error: `Could not save per-line overrides: ${lineErr.error.message}` };

  const { error: persistError } = await persistComputed(supabase, prospective.quote, result);
  if (persistError) return { ok: false, error: persistError };

  // Log the override(s), one row per distinct breach type.
  if (result.requiresOverride && reason) {
    const summaries = summarizeFlags(result.flags);
    const { error: logError } = await supabase.from("override_log").insert(
      summaries.map((s) => ({
        quote_id: quoteId,
        override_type: s.type,
        requested_margin_pct: s.minMarginPct,
        landed_cost_usd: result.totals.landedCostUsd,
        quoted_price_usd: result.totals.clientPriceUsd,
        reason,
        overridden_by: user.id,
      }))
    );
    if (logError) return { ok: false, error: `Pricing saved but the override could not be logged: ${logError.message}` };
  }

  revalidatePath(`/admin/quotes/${quoteId}`);
  revalidatePath("/admin/overrides");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// FX snapshot refresh (draft-only)
// ---------------------------------------------------------------------------

/**
 * Re-snapshots the FX rates from the CURRENT business_parameters and
 * recomputes the quote. Allowed only in draft — a sent quote's FX is locked
 * on issuance (§6.3.6). Only the FX snapshot is refreshed here (the label on
 * the panel); the parameter snapshot is left untouched so an in-progress
 * quote's cost assumptions don't shift under the founder mid-edit.
 */
export async function refreshFxSnapshot(quoteId: string): Promise<FxActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, status, quote_date")
    .eq("id", quoteId)
    .maybeSingle();
  if (quoteError) return { ok: false, error: `Could not load the quote: ${quoteError.message}` };
  if (!quote) return { ok: false, error: "Quote not found." };
  if (quote.status !== "draft") return { ok: false, error: "FX can only be refreshed on a draft quote." };

  const { data: paramRows, error: paramError } = await supabase
    .from("business_parameters")
    .select("*")
    .in("key", ["fx_bank_sell_rate_usd_jmd", "fx_risk_buffer_pct", "supplier_fx_rates"]);
  if (paramError) return { ok: false, error: `Could not load FX parameters: ${paramError.message}` };

  const asOf = new Date().toISOString().slice(0, 10);
  const fxSnapshot = buildFxSnapshot((paramRows as BusinessParameterRow[]) ?? [], asOf);

  const { error: updateError } = await supabase.from("quotes").update({ fx_snapshot: fxSnapshot }).eq("id", quoteId);
  if (updateError) return { ok: false, error: `Could not refresh FX: ${updateError.message}` };

  const { error: computeError } = await recomputeQuote(supabase, quoteId);
  if (computeError) return { ok: false, error: computeError };

  revalidatePath(`/admin/quotes/${quoteId}`);
  return { ok: true };
}

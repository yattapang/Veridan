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
  ContactRow,
  ParametersSnapshotStored,
  QuoteLineItemRow,
  QuoteOriginRow,
  QuoteRow,
} from "@/lib/supabase/types";
import {
  buildOriginGroups,
  computeQuoteResult,
  planOriginRegroup,
  supplierOriginKey,
  supplierOriginLabelMap,
  type SupplierOriginFields,
  type QuoteState,
} from "./mapping";

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
 * Looks up a company's first contact (primary preferred) so the Task 19 send
 * form can prefill a recipient — the founder can still pick/enter a
 * different address. Kept here (a plain data-loading module) rather than in
 * app/admin/quotes/[id]/workflowActions.ts, which is a "use server" actions
 * file also imported by a client component (WorkflowPanel) — every export of
 * such a file must be an async server action with a client-safe signature,
 * and this helper's Supabase-client argument doesn't fit that shape.
 */
export async function loadDefaultRecipientEmail(
  supabase: Client,
  companyId: string | null | undefined,
): Promise<string | null> {
  if (!companyId) return null;
  const { data, error } = await supabase
    .from("contacts")
    .select("email")
    .eq("company_id", companyId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return null;
  const rows = (data as Array<Pick<ContactRow, "email">>) ?? [];
  return rows[0]?.email ?? null;
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
 * Finds (or creates) the quote_origins row for a single supplier's origin
 * label on a quote (Task 17). Used when adding a brand-new line_item-mode
 * line: quote_line_items.quote_origin_id is NOT NULL, so a line can't be
 * inserted before it has somewhere to land. This resolves just that one
 * origin; the caller should still follow up with regroupLineItemOrigins
 * (idempotent) so the pools stay fully consistent across concurrent edits.
 */
export async function ensureOriginForSupplier(
  supabase: Client,
  quoteId: string,
  supplier: SupplierOriginFields,
  parametersSnapshot: ParametersSnapshotStored,
): Promise<{ originId: string | null; error: string | null }> {
  const label = supplierOriginKey(supplier);

  const { data: existing, error: findError } = await supabase
    .from("quote_origins")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("origin_label", label)
    .maybeSingle();
  if (findError) return { originId: null, error: findError.message };
  if (existing) return { originId: existing.id as string, error: null };

  const { data: inserted, error: insertError } = await supabase
    .from("quote_origins")
    .insert({
      quote_id: quoteId,
      origin_label: label,
      freight_export_fees_usd: 0,
      ocean_freight_usd: null,
      marine_insurance_usd: null,
      port_handling_usd: parametersSnapshot.port_handling_usd,
      brokerage_usd: null,
      pallet_count: 1,
      duty_gct_pct: parametersSnapshot.duty_gct_pct,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return { originId: null, error: insertError?.message ?? "Could not create a shipment origin." };
  }
  return { originId: inserted.id as string, error: null };
}

/**
 * Re-derives a line_item-mode quote's origin pools from whichever suppliers
 * its CURRENT lines actually use (Task 17). door_register mode never needs
 * this — its origins are fixed once at quote-materialization time — but
 * line_item-mode lines are added/edited/removed one at a time directly on
 * the draft, so the origin pools must be reconciled after every change:
 *   1. Group the quote's current lines' suppliers into origin labels, using
 *      the SAME buildOriginGroups logic Task 16 uses for door_register.
 *   2. Create any label that doesn't have a quote_origins row yet (seeded
 *      from the quote's frozen parameters_snapshot, same defaults as a
 *      freshly materialized door_register origin).
 *   3. Point every line's quote_origin_id at the right pool.
 *   4. Delete any origin whose label is no longer used by any line (safe —
 *      step 3 already moved every line off it).
 * Callers should follow this with recomputeQuote to re-run the engine over
 * the now-consistent origins/lines.
 */
export async function regroupLineItemOrigins(
  supabase: Client,
  quoteId: string,
): Promise<{ error: string | null }> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, parameters_snapshot")
    .eq("id", quoteId)
    .maybeSingle();
  if (quoteError) return { error: quoteError.message };
  if (!quote) return { error: "Quote not found." };
  const snapshot = quote.parameters_snapshot as ParametersSnapshotStored;

  const { data: lineRows, error: lineError } = await supabase
    .from("quote_line_items")
    .select("id, supplier_id")
    .eq("quote_id", quoteId);
  if (lineError) return { error: lineError.message };
  const lines = (lineRows as Array<{ id: string; supplier_id: string | null }>) ?? [];

  const supplierIds = [...new Set(lines.map((l) => l.supplier_id).filter((v): v is string => Boolean(v)))];
  let suppliers: SupplierOriginFields[] = [];
  if (supplierIds.length > 0) {
    const { data: supplierRows, error: supplierError } = await supabase
      .from("suppliers")
      .select("id, origin_region, country")
      .in("id", supplierIds);
    if (supplierError) return { error: supplierError.message };
    suppliers = (supplierRows as SupplierOriginFields[]) ?? [];
  }

  const groups = buildOriginGroups(suppliers);
  const supplierToLabel = supplierOriginLabelMap(groups);

  const { data: originRows, error: originsError } = await supabase
    .from("quote_origins")
    .select("id, origin_label")
    .eq("quote_id", quoteId);
  if (originsError) return { error: originsError.message };
  const existingOrigins = (originRows as Array<{ id: string; origin_label: string }>) ?? [];

  const plan = planOriginRegroup(existingOrigins, groups);
  const labelToId = new Map(plan.existingIdByLabel);

  if (plan.labelsToCreate.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from("quote_origins")
      .insert(
        plan.labelsToCreate.map((label) => ({
          quote_id: quoteId,
          origin_label: label,
          freight_export_fees_usd: 0,
          ocean_freight_usd: null,
          marine_insurance_usd: null,
          port_handling_usd: snapshot?.port_handling_usd ?? null,
          brokerage_usd: null,
          pallet_count: 1,
          duty_gct_pct: snapshot?.duty_gct_pct ?? null,
        })),
      )
      .select("id, origin_label");
    if (insertError) return { error: insertError.message };
    for (const o of (inserted as Array<{ id: string; origin_label: string }>) ?? []) {
      labelToId.set(o.origin_label, o.id);
    }
  }

  const lineUpdates = lines.map((l) => {
    const label = l.supplier_id ? (supplierToLabel.get(l.supplier_id) ?? "Other") : "Other";
    const originId = labelToId.get(label);
    return supabase.from("quote_line_items").update({ quote_origin_id: originId }).eq("id", l.id);
  });
  if (lineUpdates.length > 0) {
    const results = await Promise.all(lineUpdates);
    const lineErr = results.find((r) => r.error);
    if (lineErr?.error) return { error: lineErr.error.message };
  }

  if (plan.originIdsToRemove.length > 0) {
    const { error: deleteError } = await supabase.from("quote_origins").delete().in("id", plan.originIdsToRemove);
    if (deleteError) return { error: deleteError.message };
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

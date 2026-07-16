"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { toUsd } from "@/lib/landed-cost/engine";
import { fxSnapshotToEngine } from "@/lib/quotes/snapshot";
import { ensureOriginForSupplier, recomputeQuote, regroupLineItemOrigins } from "@/lib/quotes/persist";
import { CURRENCY_CODES, type CurrencyCode, type ParametersSnapshotStored, type QuoteRow } from "@/lib/supabase/types";

/**
 * Line add/edit/remove for line_item-mode quotes (Task 17 — retrofit/simple
 * jobs, §6.2). Mirrors the hardware-set line-item actions
 * (app/admin/projects/[id]/hardware-sets/[setId]/actions.ts) but writes
 * DIRECTLY to quote_line_items on a draft quote, since line_item mode has no
 * hardware-set staging step. Every mutation here is followed by
 * regroupLineItemOrigins (re-derive origin pools from the lines' suppliers)
 * and recomputeQuote (re-run the engine + persist caches) — "no client-side
 * calc, recompute after every edit" holds for this mode exactly as it does
 * for door_register (lib/quotes/persist.ts header).
 */

export type QuoteLineActionResult = { ok: true; error?: undefined } | { ok: false; error: string };

export const initialQuoteLineActionResult: QuoteLineActionResult = { ok: true };

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && (CURRENCY_CODES as string[]).includes(value);
}

async function loadDraftLineItemQuote(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quoteId: string,
): Promise<{ quote: QuoteRow } | { error: string }> {
  const { data: quote, error } = await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (error) return { error: `Could not load the quote: ${error.message}` };
  if (!quote) return { error: "Quote not found." };
  const row = quote as QuoteRow;
  if (row.quote_mode !== "line_item") return { error: "This quote is not in line-item mode." };
  if (row.status !== "draft") return { error: "Only draft quotes can be edited." };
  return { quote: row };
}

async function finalizeAfterLineChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quoteId: string,
): Promise<QuoteLineActionResult> {
  const { error: regroupError } = await regroupLineItemOrigins(supabase, quoteId);
  if (regroupError) return { ok: false, error: `Line saved but origin pools could not be regrouped: ${regroupError}` };

  const { error: computeError } = await recomputeQuote(supabase, quoteId);
  if (computeError) return { ok: false, error: `Line saved but recompute failed: ${computeError}` };

  revalidatePath(`/admin/quotes/${quoteId}`);
  return { ok: true };
}

/** Adds a line picked from the Hardware Library (product_id set). */
export async function addLibraryQuoteLine(
  quoteId: string,
  _prevState: QuoteLineActionResult,
  formData: FormData,
): Promise<QuoteLineActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const loaded = await loadDraftLineItemQuote(supabase, quoteId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { quote } = loaded;

  const productId = String(formData.get("product_id") ?? "").trim();
  if (!productId) return { ok: false, error: "Choose a product to add." };
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (!supplierId) return { ok: false, error: "Choose a supplier for this line." };

  const qtyRaw = formData.get("qty");
  const qty = Number(qtyRaw);
  if (qtyRaw === null || qtyRaw === "" || !Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Enter a quantity greater than zero." };
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, unit_cost, cost_currency")
    .eq("id", productId)
    .maybeSingle();
  if (productError) return { ok: false, error: `Could not load the product: ${productError.message}` };
  if (!product) return { ok: false, error: "Product not found." };

  const overrideCostRaw = String(formData.get("unit_cost_override") ?? "").trim();
  const overrideCurrencyRaw = String(formData.get("cost_currency_override") ?? "").trim();
  let unitCost = product.unit_cost as number;
  let costCurrency = product.cost_currency as CurrencyCode;
  if (overrideCostRaw || overrideCurrencyRaw) {
    const cost = Number(overrideCostRaw);
    if (!overrideCostRaw || !Number.isFinite(cost) || cost < 0) {
      return { ok: false, error: "Enter a valid override unit cost (zero or greater), or leave both override fields blank." };
    }
    if (!isCurrencyCode(overrideCurrencyRaw)) {
      return { ok: false, error: "Choose a valid override currency, or leave both override fields blank." };
    }
    unitCost = cost;
    costCurrency = overrideCurrencyRaw;
  }

  const { data: supplier, error: supplierError } = await supabase
    .from("suppliers")
    .select("id, origin_region, country")
    .eq("id", supplierId)
    .maybeSingle();
  if (supplierError) return { ok: false, error: `Could not load the supplier: ${supplierError.message}` };
  if (!supplier) return { ok: false, error: "Supplier not found." };

  const { originId, error: originError } = await ensureOriginForSupplier(
    supabase,
    quoteId,
    supplier,
    quote.parameters_snapshot as ParametersSnapshotStored,
  );
  if (originError || !originId) return { ok: false, error: originError ?? "Could not resolve a shipment origin." };

  const unitCostUsd = toUsd(unitCost, costCurrency, fxSnapshotToEngine(quote.fx_snapshot)) ?? 0;
  const lineValueUsd = qty * unitCostUsd;

  const { count } = await supabase
    .from("quote_line_items")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId);

  const { error: insertError } = await supabase.from("quote_line_items").insert({
    quote_id: quoteId,
    product_id: productId,
    supplier_id: supplierId,
    quote_origin_id: originId,
    qty,
    unit_cost: unitCost,
    cost_currency: costCurrency,
    unit_cost_usd: unitCostUsd,
    line_value_usd: lineValueUsd,
    landed_cost_usd: lineValueUsd, // placeholder; recompute overwrites with the allocated landed cost
    sort_order: count ?? 0,
  });
  if (insertError) return { ok: false, error: `Could not add the line: ${insertError.message}` };

  return finalizeAfterLineChange(supabase, quoteId);
}

/** Adds a free-text ad-hoc line (no Hardware Library entry, product_id null). */
export async function addAdHocQuoteLine(
  quoteId: string,
  _prevState: QuoteLineActionResult,
  formData: FormData,
): Promise<QuoteLineActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const loaded = await loadDraftLineItemQuote(supabase, quoteId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { quote } = loaded;

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, error: "Enter a description for this line." };
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (!supplierId) return { ok: false, error: "Choose a supplier for this line." };

  const qtyRaw = formData.get("qty");
  const qty = Number(qtyRaw);
  if (qtyRaw === null || qtyRaw === "" || !Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Enter a quantity greater than zero." };
  }

  const unitCostRaw = String(formData.get("unit_cost") ?? "").trim();
  const unitCost = Number(unitCostRaw);
  if (!unitCostRaw || !Number.isFinite(unitCost) || unitCost < 0) {
    return { ok: false, error: "Enter a valid unit cost (zero or greater)." };
  }

  const costCurrency = formData.get("cost_currency");
  if (!isCurrencyCode(costCurrency)) return { ok: false, error: "Choose a valid currency." };

  const { data: supplier, error: supplierError } = await supabase
    .from("suppliers")
    .select("id, origin_region, country")
    .eq("id", supplierId)
    .maybeSingle();
  if (supplierError) return { ok: false, error: `Could not load the supplier: ${supplierError.message}` };
  if (!supplier) return { ok: false, error: "Supplier not found." };

  const { originId, error: originError } = await ensureOriginForSupplier(
    supabase,
    quoteId,
    supplier,
    quote.parameters_snapshot as ParametersSnapshotStored,
  );
  if (originError || !originId) return { ok: false, error: originError ?? "Could not resolve a shipment origin." };

  const unitCostUsd = toUsd(unitCost, costCurrency, fxSnapshotToEngine(quote.fx_snapshot)) ?? 0;
  const lineValueUsd = qty * unitCostUsd;

  const { count } = await supabase
    .from("quote_line_items")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quoteId);

  const { error: insertError } = await supabase.from("quote_line_items").insert({
    quote_id: quoteId,
    product_id: null,
    supplier_id: supplierId,
    quote_origin_id: originId,
    description_override: description,
    qty,
    unit_cost: unitCost,
    cost_currency: costCurrency,
    unit_cost_usd: unitCostUsd,
    line_value_usd: lineValueUsd,
    landed_cost_usd: lineValueUsd,
    sort_order: count ?? 0,
  });
  if (insertError) return { ok: false, error: `Could not add the line: ${insertError.message}` };

  return finalizeAfterLineChange(supabase, quoteId);
}

/**
 * Edits an existing line_item-mode line: qty, cost, currency, and supplier
 * (which may move it to a different origin pool — finalizeAfterLineChange's
 * regroup handles that). Product-picked and ad-hoc lines share this action;
 * a product-picked line keeps its product_id and can still have its cost/
 * currency/supplier adjusted per-quote, same as the hardware-set override
 * pattern.
 */
export async function updateQuoteLine(
  quoteId: string,
  lineId: string,
  _prevState: QuoteLineActionResult,
  formData: FormData,
): Promise<QuoteLineActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const loaded = await loadDraftLineItemQuote(supabase, quoteId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { quote } = loaded;

  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (!supplierId) return { ok: false, error: "Choose a supplier for this line." };

  const qtyRaw = formData.get("qty");
  const qty = Number(qtyRaw);
  if (qtyRaw === null || qtyRaw === "" || !Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Enter a quantity greater than zero." };
  }

  const unitCostRaw = String(formData.get("unit_cost") ?? "").trim();
  const unitCost = Number(unitCostRaw);
  if (!unitCostRaw || !Number.isFinite(unitCost) || unitCost < 0) {
    return { ok: false, error: "Enter a valid unit cost (zero or greater)." };
  }

  const costCurrency = formData.get("cost_currency");
  if (!isCurrencyCode(costCurrency)) return { ok: false, error: "Choose a valid currency." };

  const descriptionRaw = String(formData.get("description") ?? "").trim();

  const { data: existingLine, error: lineError } = await supabase
    .from("quote_line_items")
    .select("id, product_id")
    .eq("id", lineId)
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (lineError) return { ok: false, error: `Could not load the line: ${lineError.message}` };
  if (!existingLine) return { ok: false, error: "Line not found." };
  if (!existingLine.product_id && !descriptionRaw) {
    return { ok: false, error: "Ad-hoc lines need a description." };
  }

  const { data: supplier, error: supplierError } = await supabase
    .from("suppliers")
    .select("id, origin_region, country")
    .eq("id", supplierId)
    .maybeSingle();
  if (supplierError) return { ok: false, error: `Could not load the supplier: ${supplierError.message}` };
  if (!supplier) return { ok: false, error: "Supplier not found." };

  const unitCostUsd = toUsd(unitCost, costCurrency, fxSnapshotToEngine(quote.fx_snapshot)) ?? 0;
  const lineValueUsd = qty * unitCostUsd;

  const { error: updateError } = await supabase
    .from("quote_line_items")
    .update({
      supplier_id: supplierId,
      qty,
      unit_cost: unitCost,
      cost_currency: costCurrency,
      unit_cost_usd: unitCostUsd,
      line_value_usd: lineValueUsd,
      ...(existingLine.product_id ? {} : { description_override: descriptionRaw }),
    })
    .eq("id", lineId)
    .eq("quote_id", quoteId);
  if (updateError) return { ok: false, error: `Could not save the line: ${updateError.message}` };

  return finalizeAfterLineChange(supabase, quoteId);
}

/** Removes a line_item-mode line and regroups/recomputes what's left. */
export async function deleteQuoteLine(quoteId: string, lineId: string): Promise<QuoteLineActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const loaded = await loadDraftLineItemQuote(supabase, quoteId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const { error: deleteError } = await supabase
    .from("quote_line_items")
    .delete()
    .eq("id", lineId)
    .eq("quote_id", quoteId);
  if (deleteError) return { ok: false, error: `Could not remove the line: ${deleteError.message}` };

  return finalizeAfterLineChange(supabase, quoteId);
}

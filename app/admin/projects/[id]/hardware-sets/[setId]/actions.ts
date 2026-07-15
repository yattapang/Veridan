"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CURRENCY_CODES, type CurrencyCode } from "@/lib/supabase/types";

export type LineItemActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export const initialLineItemActionResult: LineItemActionResult = { ok: true };

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && (CURRENCY_CODES as string[]).includes(value);
}

/**
 * Parses the shared qty / supplier / per-line override / notes fields
 * (§1.4) from a line-item form submission. Both override fields must be
 * present together or neither is stored — a lone cost with no currency
 * (or vice versa) is treated as "no override" and rejected with a clear
 * error rather than silently guessing a currency.
 */
function parseLineFields(
  formData: FormData
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (!supplierId) {
    return { ok: false, error: "Choose a supplier for this line." };
  }

  const qtyRaw = formData.get("qty");
  const qty = Number(qtyRaw);
  if (qtyRaw === null || qtyRaw === "" || !Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Enter a quantity greater than zero." };
  }

  const overrideCostRaw = String(formData.get("unit_cost_override") ?? "").trim();
  const overrideCurrencyRaw = String(formData.get("cost_currency_override") ?? "").trim();

  let unitCostOverride: number | null = null;
  let costCurrencyOverride: CurrencyCode | null = null;

  if (overrideCostRaw || overrideCurrencyRaw) {
    const cost = Number(overrideCostRaw);
    if (!overrideCostRaw || !Number.isFinite(cost) || cost < 0) {
      return { ok: false, error: "Enter a valid override unit cost (zero or greater), or leave both override fields blank." };
    }
    if (!isCurrencyCode(overrideCurrencyRaw)) {
      return { ok: false, error: "Choose a valid override currency, or leave both override fields blank." };
    }
    unitCostOverride = cost;
    costCurrencyOverride = overrideCurrencyRaw;
  }

  const notes = String(formData.get("notes") ?? "").trim();

  return {
    ok: true,
    fields: {
      supplier_id: supplierId,
      qty,
      unit_cost_override: unitCostOverride,
      cost_currency_override: costCurrencyOverride,
      notes: notes || null,
    },
  };
}

export async function addLineItem(
  projectId: string,
  setId: string,
  _prevState: LineItemActionResult,
  formData: FormData
): Promise<LineItemActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const productId = String(formData.get("product_id") ?? "").trim();
  if (!productId) {
    return { ok: false, error: "Choose a product to add." };
  }

  const parsed = parseLineFields(formData);
  if (!parsed.ok) return parsed;

  const { count } = await supabase
    .from("hardware_set_line_items")
    .select("id", { count: "exact", head: true })
    .eq("hardware_set_id", setId);

  const { error } = await supabase.from("hardware_set_line_items").insert({
    ...parsed.fields,
    hardware_set_id: setId,
    product_id: productId,
    sort_order: count ?? 0,
  });

  if (error) {
    return { ok: false, error: `Could not add the line item: ${error.message}` };
  }

  revalidatePath(`/admin/projects/${projectId}/hardware-sets/${setId}`);
  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}

export async function updateLineItem(
  projectId: string,
  setId: string,
  lineId: string,
  _prevState: LineItemActionResult,
  formData: FormData
): Promise<LineItemActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const parsed = parseLineFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("hardware_set_line_items").update(parsed.fields).eq("id", lineId);
  if (error) {
    return { ok: false, error: `Could not save the line item: ${error.message}` };
  }

  revalidatePath(`/admin/projects/${projectId}/hardware-sets/${setId}`);
  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}

/**
 * Line items have no `active` flag (unlike suppliers/products) and no
 * historical-quote significance of their own until they're pulled into a
 * quote — quote_line_items snapshots its own cost independently — so a
 * hard delete is safe here, mirroring the contacts pattern.
 */
export async function deleteLineItem(
  projectId: string,
  setId: string,
  lineId: string
): Promise<LineItemActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const { error } = await supabase.from("hardware_set_line_items").delete().eq("id", lineId);
  if (error) {
    return { ok: false, error: `Could not remove the line item: ${error.message}` };
  }

  revalidatePath(`/admin/projects/${projectId}/hardware-sets/${setId}`);
  revalidatePath(`/admin/projects/${projectId}`);
  return { ok: true };
}

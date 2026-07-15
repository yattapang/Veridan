"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CURRENCY_CODES, type CurrencyCode } from "@/lib/supabase/types";

export type SupplierFormResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export const initialSupplierFormResult: SupplierFormResult = { ok: true };

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && (CURRENCY_CODES as string[]).includes(value);
}

/**
 * Reads and validates the shared supplier field set (§1.1) from a
 * FormData payload. Used by both create and update actions.
 */
function parseSupplierFields(
  formData: FormData
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { ok: false, error: "Supplier name is required." };
  }

  const defaultCurrency = formData.get("default_currency");
  if (!isCurrencyCode(defaultCurrency)) {
    return { ok: false, error: "Choose a valid default currency." };
  }

  const country = String(formData.get("country") ?? "").trim();
  const originRegion = String(formData.get("origin_region") ?? "").trim();
  const leadTime = String(formData.get("default_lead_time_text") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  return {
    ok: true,
    fields: {
      name,
      country: country || null,
      origin_region: originRegion || null,
      default_currency: defaultCurrency,
      default_lead_time_text: leadTime || null,
      notes: notes || null,
    },
  };
}

export async function createSupplier(
  _prevState: SupplierFormResult,
  formData: FormData
): Promise<SupplierFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const parsed = parseSupplierFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("suppliers").insert(parsed.fields);
  if (error) {
    return { ok: false, error: `Could not create supplier: ${error.message}` };
  }

  revalidatePath("/admin/suppliers");
  return { ok: true };
}

export async function updateSupplier(
  id: string,
  _prevState: SupplierFormResult,
  formData: FormData
): Promise<SupplierFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const parsed = parseSupplierFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("suppliers").update(parsed.fields).eq("id", id);
  if (error) {
    return { ok: false, error: `Could not save supplier: ${error.message}` };
  }

  revalidatePath("/admin/suppliers");
  return { ok: true };
}

/**
 * Suppliers are referenced by historical products/quote lines, so this is
 * a soft archive (toggle `active`), never a hard delete — the schema's
 * `active` column exists specifically for this (§1.1 note: "soft-disable
 * instead of delete (referenced by historical quotes)").
 */
export async function setSupplierActive(id: string, active: boolean): Promise<SupplierFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const { error } = await supabase.from("suppliers").update({ active }).eq("id", id);
  if (error) {
    return { ok: false, error: `Could not update supplier: ${error.message}` };
  }

  revalidatePath("/admin/suppliers");
  return { ok: true };
}

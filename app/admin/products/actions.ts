"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CURRENCY_CODES, PRODUCT_CATEGORIES, type CurrencyCode, type ProductCategory } from "@/lib/supabase/types";

export type ProductFormResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export const initialProductFormResult: ProductFormResult = { ok: true };

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && (CURRENCY_CODES as string[]).includes(value);
}

function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === "string" && (PRODUCT_CATEGORIES as string[]).includes(value);
}

/** Reads and validates the product field set (§1.2) from a FormData payload. */
function parseProductFields(
  formData: FormData
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const description = String(formData.get("description") ?? "").trim();
  if (!description) {
    return { ok: false, error: "Description is required." };
  }

  const category = formData.get("generic_category");
  if (!isProductCategory(category)) {
    return { ok: false, error: "Choose a valid category." };
  }

  const unit = String(formData.get("unit") ?? "").trim();
  if (!unit) {
    return { ok: false, error: "Unit is required (e.g. each, set, pair)." };
  }

  const unitCostRaw = formData.get("unit_cost");
  const unitCost = Number(unitCostRaw);
  if (unitCostRaw === null || unitCostRaw === "" || !Number.isFinite(unitCost) || unitCost < 0) {
    return { ok: false, error: "Enter a valid unit cost (zero or greater)." };
  }

  const costCurrency = formData.get("cost_currency");
  if (!isCurrencyCode(costCurrency)) {
    return { ok: false, error: "Choose a valid cost currency." };
  }

  const supplierIdRaw = String(formData.get("supplier_id") ?? "").trim();

  const catalogueRef = String(formData.get("catalogue_ref") ?? "").trim();
  const specifiedFinish = String(formData.get("specified_finish") ?? "").trim();
  const suppliedFinish = String(formData.get("supplied_finish") ?? "").trim();
  const manufacturer = String(formData.get("manufacturer") ?? "").trim();
  const productRef = String(formData.get("product_ref") ?? "").trim();

  return {
    ok: true,
    fields: {
      generic_category: category,
      description,
      catalogue_ref: catalogueRef || null,
      specified_finish: specifiedFinish || null,
      supplied_finish: suppliedFinish || null,
      manufacturer: manufacturer || null,
      product_ref: productRef || null,
      supplier_id: supplierIdRaw || null,
      unit,
      unit_cost: unitCost,
      cost_currency: costCurrency,
    },
  };
}

export async function createProduct(
  _prevState: ProductFormResult,
  formData: FormData
): Promise<ProductFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const parsed = parseProductFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("products").insert(parsed.fields);
  if (error) {
    return { ok: false, error: `Could not create product: ${error.message}` };
  }

  revalidatePath("/admin/products");
  return { ok: true };
}

export async function updateProduct(
  id: string,
  _prevState: ProductFormResult,
  formData: FormData
): Promise<ProductFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const parsed = parseProductFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("products").update(parsed.fields).eq("id", id);
  if (error) {
    return { ok: false, error: `Could not save product: ${error.message}` };
  }

  revalidatePath("/admin/products");
  return { ok: true };
}

/**
 * Products are referenced by historical hardware-set line items and past
 * quote lines (which snapshot their own cost independently), so this is a
 * soft archive, never a hard delete — mirrors the suppliers pattern.
 */
export async function setProductActive(id: string, active: boolean): Promise<ProductFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const { error } = await supabase.from("products").update({ active }).eq("id", id);
  if (error) {
    return { ok: false, error: `Could not update product: ${error.message}` };
  }

  revalidatePath("/admin/products");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  BusinessParameterRow,
  ParameterValueType,
} from "@/lib/supabase/types";

export type UpdateParameterResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

/**
 * Validates a raw form submission for a given parameter's `value_type`,
 * plus a couple of table-shaped keys that need their own structural
 * check. Keeps validation simple but safe per Task 6's brief — numerics
 * parse and are sane (percentages 0-100, money >= 0), JSON payloads are
 * checked for valid JSON and a plausible shape.
 */
function parseAndValidate(
  key: string,
  valueType: ParameterValueType,
  formData: FormData
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (valueType === "boolean") {
    return { ok: true, value: formData.get("value") === "on" };
  }

  if (valueType === "numeric" || valueType === "percent") {
    const raw = formData.get("value");
    if (raw === null || raw === "") {
      return { ok: false, error: "Enter a value." };
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      return { ok: false, error: "Enter a valid number." };
    }
    if (valueType === "percent" && (num < 0 || num > 100)) {
      return { ok: false, error: "Percentages must be between 0 and 100." };
    }
    if (valueType === "numeric" && key.endsWith("_usd") && num < 0) {
      return { ok: false, error: "Money values must be zero or greater." };
    }
    if (valueType === "numeric" && key === "quote_validity_days" && (num < 0 || !Number.isInteger(num))) {
      return { ok: false, error: "Validity days must be a whole number, zero or greater." };
    }
    return { ok: true, value: num };
  }

  if (valueType === "text") {
    const raw = formData.get("value");
    const str = typeof raw === "string" ? raw.trim() : "";
    if (!str) {
      return { ok: false, error: "Value cannot be empty." };
    }
    return { ok: true, value: str };
  }

  if (valueType === "table") {
    const raw = formData.get("value");
    if (typeof raw !== "string" || !raw.trim()) {
      return { ok: false, error: "Value cannot be empty." };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Invalid JSON — check the syntax." };
    }
    const shapeError = validateTableShape(key, parsed);
    if (shapeError) {
      return { ok: false, error: shapeError };
    }
    return { ok: true, value: parsed };
  }

  return { ok: false, error: `Unknown value type: ${String(valueType)}` };
}

function validateTableShape(key: string, parsed: unknown): string | null {
  if (key === "margin_tiers") {
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)
    ) {
      return "margin_tiers must be a non-empty JSON array of percentages (0-100).";
    }
    return null;
  }

  if (key === "supplier_fx_rates" || key === "lead_times" || key === "company_details") {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return `${key} must be a JSON object.`;
    }
  }

  if (key === "supplier_fx_rates") {
    const obj = parsed as Record<string, unknown>;
    for (const [currency, rate] of Object.entries(obj)) {
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        return `supplier_fx_rates.${currency} must be a positive number.`;
      }
    }
  }

  if (key === "lead_times") {
    const obj = parsed as Record<string, unknown>;
    for (const [origin, text] of Object.entries(obj)) {
      if (typeof text !== "string" || !text.trim()) {
        return `lead_times.${origin} must be a non-empty string.`;
      }
    }
  }

  return null;
}

/**
 * Updates a single business_parameters row and writes a
 * parameter_audit_log entry (Task 6 save path). The two writes are
 * sequential, not a single DB transaction (supabase-js has no
 * multi-statement transaction API without a Postgres function) — if the
 * audit write fails after the parameter write succeeds, that is surfaced
 * to the caller rather than silently dropped.
 */
export async function updateParameter(
  key: string,
  _prevState: UpdateParameterResult,
  formData: FormData
): Promise<UpdateParameterResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Supabase is not configured for this environment.",
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, error: "You must be signed in to change parameters." };
  }

  const { data: existing, error: fetchError } = await supabase
    .from("business_parameters")
    .select("*")
    .eq("key", key)
    .maybeSingle<BusinessParameterRow>();

  if (fetchError) {
    return { ok: false, error: `Could not load parameter: ${fetchError.message}` };
  }
  if (!existing) {
    return { ok: false, error: `Parameter "${key}" not found.` };
  }

  const parsed = parseAndValidate(key, existing.value_type, formData);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const oldValue = existing.value;
  const newValue = { ...existing.value, value: parsed.value };

  const { error: updateError } = await supabase
    .from("business_parameters")
    .update({
      value: newValue,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("key", key);

  if (updateError) {
    return { ok: false, error: `Save failed: ${updateError.message}` };
  }

  const reasonRaw = formData.get("reason");
  const reason = typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw.trim() : null;

  const { error: auditError } = await supabase.from("parameter_audit_log").insert({
    parameter_key: key,
    old_value: oldValue,
    new_value: newValue,
    changed_by: user.id,
    reason,
  });

  if (auditError) {
    return {
      ok: false,
      error: `Parameter was updated, but the audit log entry failed: ${auditError.message}. Please report this.`,
    };
  }

  revalidatePath("/admin/parameters");
  return { ok: true };
}

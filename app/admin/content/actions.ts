"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type { SiteContentKey } from "@/lib/site-content-db/types";
import {
  isValidSiteMetaEditable,
  isValidContactInfoEditable,
  isValidBrandsSuppliedEditable,
  isValidTrustSignalsEditable,
  isValidTestimonialsEditable,
  isValidServiceLinesEditable,
  isValidProductCategoriesEditable,
  isValidFoundersEditable,
  isValidAboutStoryEditable,
} from "@/lib/site-content-db/validation";

export type SaveSectionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function reasonFromFormData(formData: FormData): string | null {
  const raw = formData.get("reason");
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function parseItemsField(formData: FormData): { ok: true; items: unknown[] } | { ok: false; error: string } {
  const raw = formData.get("items");
  if (typeof raw !== "string") {
    return { ok: false, error: "No items submitted." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Could not read the submitted rows — please reload and try again." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Submitted rows must be a list." };
  }
  return { ok: true, items: parsed };
}

/**
 * Shared save path for every section (mirrors admin/parameters/actions.ts's
 * updateParameter: load existing row for the audit-log old_value, write the
 * new value, write the audit-log row, revalidate). Not exported — a
 * "use server" file may only export async Server Functions (Plan §1: "every
 * use-server file exports only async functions"), so this stays a private
 * helper called by the exported per-section actions below.
 */
async function saveSection(
  key: SiteContentKey,
  newValue: unknown,
  reason: string | null
): Promise<SaveSectionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Supabase is not configured for this environment.",
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to change site content." };
  }

  const { data: existing, error: fetchError } = await supabase
    .from("site_content")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, error: `Could not load "${key}": ${fetchError.message}` };
  }
  if (!existing) {
    return {
      ok: false,
      error: `Content section "${key}" was not found — has the site_content migration been applied?`,
    };
  }

  const oldValue = existing.value;
  const newEnvelope = { type: "table" as const, value: newValue };

  const { error: updateError } = await supabase
    .from("site_content")
    .update({
      value: newEnvelope,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("key", key);

  if (updateError) {
    return { ok: false, error: `Save failed: ${updateError.message}` };
  }

  const { error: auditError } = await supabase.from("site_content_audit_log").insert({
    content_key: key,
    old_value: oldValue,
    new_value: newEnvelope,
    changed_by: user.id,
    reason,
  });

  if (auditError) {
    return {
      ok: false,
      error: `Content was updated, but the audit log entry failed: ${auditError.message}. Please report this.`,
    };
  }

  // { expire: 0 } = immediate invalidation, not the "max"/stale-while-
  // revalidate profile — Plan §1.5 promises an edit is "visible on the live
  // site on the next request", not "visible after one more stale serve".
  revalidateTag(`site-content:${key}`, { expire: 0 });
  revalidatePath("/admin/content");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Scalar sections
// ---------------------------------------------------------------------------

export async function saveSiteMeta(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const value = {
    tagline: str(formData.get("tagline")),
    positioning: str(formData.get("positioning")),
    description: str(formData.get("description")),
    locality: str(formData.get("locality")),
  };
  if (!isValidSiteMetaEditable(value)) {
    return { ok: false, error: "All fields (tagline, positioning, description, locality) are required." };
  }
  return saveSection("site_meta", value, reasonFromFormData(formData));
}

export async function saveContactInfo(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const value = {
    email: str(formData.get("email")),
    whatsappBusinessLabel: str(formData.get("whatsappBusinessLabel")),
    whatsappBusinessNote: str(formData.get("whatsappBusinessNote")),
    location: str(formData.get("location")),
  };
  if (!isValidContactInfoEditable(value)) {
    return { ok: false, error: "All fields (email, WhatsApp label, WhatsApp note, location) are required." };
  }
  return saveSection("contact_info", value, reasonFromFormData(formData));
}

export async function saveAboutStory(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const heading = str(formData.get("heading"));
  const bodyRaw = str(formData.get("body"));
  // Paragraphs are separated by a blank line in the textarea (Plan §1.6:
  // scalar sections use plain text inputs, never a JSON box) — split back
  // into the string[] shape aboutStory.body already has.
  const body = bodyRaw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const value = { heading, body };
  if (!isValidAboutStoryEditable(value)) {
    return { ok: false, error: "A heading and at least one non-empty paragraph are required." };
  }
  return saveSection("about_story", value, reasonFromFormData(formData));
}

// ---------------------------------------------------------------------------
// List sections
// ---------------------------------------------------------------------------

export async function saveBrandsSupplied(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const parsed = parseItemsField(formData);
  if (!parsed.ok) return parsed;
  const value = parsed.items.map((item) =>
    typeof item === "object" && item !== null && "value" in item
      ? String((item as Record<string, unknown>).value ?? "").trim()
      : ""
  );
  if (!isValidBrandsSuppliedEditable(value)) {
    return { ok: false, error: "Every brand name must be non-empty." };
  }
  return saveSection("brands_supplied", value, reasonFromFormData(formData));
}

export async function saveTrustSignals(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const parsed = parseItemsField(formData);
  if (!parsed.ok) return parsed;
  if (!isValidTrustSignalsEditable(parsed.items)) {
    return { ok: false, error: "Every trust signal needs a title and a body." };
  }
  return saveSection("trust_signals", parsed.items, reasonFromFormData(formData));
}

export async function saveTestimonials(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const parsed = parseItemsField(formData);
  if (!parsed.ok) return parsed;
  if (!isValidTestimonialsEditable(parsed.items)) {
    return { ok: false, error: "Every testimonial needs a quote and an attribution." };
  }
  return saveSection("testimonials", parsed.items, reasonFromFormData(formData));
}

export async function saveServiceLines(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const parsed = parseItemsField(formData);
  if (!parsed.ok) return parsed;
  if (!isValidServiceLinesEditable(parsed.items)) {
    return {
      ok: false,
      error: "Every service line needs a key, title, a link path starting with \"/\", and a summary.",
    };
  }
  return saveSection("service_lines", parsed.items, reasonFromFormData(formData));
}

export async function saveProductCategories(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const parsed = parseItemsField(formData);
  if (!parsed.ok) return parsed;
  if (!isValidProductCategoriesEditable(parsed.items)) {
    return { ok: false, error: "Every category needs a key, title, and description (brands may be empty)." };
  }
  return saveSection("product_categories", parsed.items, reasonFromFormData(formData));
}

export async function saveFounders(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const parsed = parseItemsField(formData);
  if (!parsed.ok) return parsed;
  if (!isValidFoundersEditable(parsed.items)) {
    return { ok: false, error: "Every founder needs a name, role, and bio." };
  }
  return saveSection("founders", parsed.items, reasonFromFormData(formData));
}

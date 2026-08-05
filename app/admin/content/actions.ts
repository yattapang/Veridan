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
  isValidInstallGalleryEditable,
  isValidConsultationBookingEditable,
} from "@/lib/site-content-db/validation";
import { validateMarketingImage } from "@/lib/marketing-uploads/imageValidation";
import {
  uploadBrandLogo,
  brandLogoPublicUrl,
  uploadInstallPhoto,
  installPhotoPublicUrl,
} from "@/lib/storage";

export type SaveSectionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

/** Result of an immediate image-upload action (brand logo / install photo) — separate from SaveSectionResult since it carries the uploaded path + public URL back to the client for local list state, not a site_content save. */
export type UploadImageResult =
  | { ok: true; error?: undefined; path: string; url: string }
  | { ok: false; error: string; path?: undefined; url?: undefined };

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
    // Optional — an admin may leave this blank; resolveContactInfo falls
    // back to the lib/site-content.ts constant's phone when it's empty.
    phone: str(formData.get("phone")),
  };
  if (!isValidContactInfoEditable(value)) {
    return { ok: false, error: "Email, WhatsApp label, WhatsApp note, and location are required." };
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

/**
 * Marketing frameworks build (2026-08-05), Framework A: `items` here are
 * `{ name, logo_path }` (BrandsEditor.tsx — a bespoke editor, not the
 * generic ListEditor, since each row also manages an optional logo image).
 * Logos themselves are uploaded separately and immediately via
 * uploadBrandLogoAction (mirrors HeroImageUploader's "upload now, save the
 * rest of the form later" split) — this action only ever receives an
 * already-uploaded Storage path, never a File. Always writes the new
 * `{name, logo_path}` object shape going forward; a legacy plain-string[]
 * row keeps validating (and rendering) until the next time a founder saves
 * this section, at which point it's normalized to the richer shape too —
 * see lib/brands/normalize.ts.
 */
export async function saveBrandsSupplied(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const parsed = parseItemsField(formData);
  if (!parsed.ok) return parsed;
  const value = parsed.items.map((item) => {
    const rec = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const logoPath =
      typeof rec.logo_path === "string" && rec.logo_path.trim() !== "" ? rec.logo_path : null;
    return { name, logo_path: logoPath };
  });
  if (!isValidBrandsSuppliedEditable(value)) {
    return { ok: false, error: "Every brand needs a non-empty name." };
  }
  return saveSection("brands_supplied", value, reasonFromFormData(formData));
}

/**
 * Immediate logo upload for one brand row (Framework A) — called from
 * BrandLogoUpload.tsx as soon as a founder picks a file, before the overall
 * "Save" button is pressed, mirroring HeroImageUploader's
 * saveHeroImage.bind(null, articleId) pattern. `brandKey` is a client-
 * generated per-row id (brands aren't DB rows with a stable id), used only
 * as the Storage path prefix so two rows' uploads never collide.
 */
export async function uploadBrandLogoAction(
  brandKey: string,
  _prevState: UploadImageResult,
  formData: FormData
): Promise<UploadImageResult> {
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
  if (!user) return { ok: false, error: "You must be signed in to upload a brand logo." };

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image file." };
  }
  const validation = validateMarketingImage(file);
  if (!validation.ok) return { ok: false, error: validation.error };

  const { path, error } = await uploadBrandLogo(supabase, brandKey, file);
  if (error || !path) {
    return { ok: false, error: `Could not upload the logo: ${error ?? "unknown error"}` };
  }
  const url = brandLogoPublicUrl(supabase, path);
  if (!url) return { ok: false, error: "Logo uploaded but its public URL could not be resolved." };

  return { ok: true, path, url };
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

// ---------------------------------------------------------------------------
// Marketing frameworks (2026-08-05) — Framework B ("Our Work" install-photo
// gallery) and Framework C ("Book a Consultation" link).
// ---------------------------------------------------------------------------

/**
 * `items` here are `{ image_path, caption? }` (InstallGalleryEditor.tsx — a
 * bespoke editor, not the generic ListEditor, since each row manages a
 * required photo upload). Photos are uploaded separately and immediately
 * via uploadInstallPhotoAction, same "upload now, save the list later"
 * split as saveBrandsSupplied/uploadBrandLogoAction above.
 */
export async function saveInstallGallery(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const parsed = parseItemsField(formData);
  if (!parsed.ok) return parsed;
  const value = parsed.items.map((item) => {
    const rec = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const image_path = typeof rec.image_path === "string" ? rec.image_path.trim() : "";
    const caption = typeof rec.caption === "string" ? rec.caption.trim() : "";
    return caption ? { image_path, caption } : { image_path };
  });
  if (!isValidInstallGalleryEditable(value)) {
    return { ok: false, error: "Every photo needs an uploaded image." };
  }
  return saveSection("install_gallery", value, reasonFromFormData(formData));
}

/**
 * Immediate photo upload for one gallery row (Framework B) — called from
 * InstallPhotoUpload.tsx as soon as a founder picks a file, mirroring
 * uploadBrandLogoAction above. No parent-entity id to key off (gallery
 * photos aren't rows in a table), so the Storage path prefix is a fixed
 * "install-photos" (see lib/storage.ts's uploadInstallPhoto).
 */
export async function uploadInstallPhotoAction(
  _prevState: UploadImageResult,
  formData: FormData
): Promise<UploadImageResult> {
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
  if (!user) return { ok: false, error: "You must be signed in to upload a photo." };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image file." };
  }
  const validation = validateMarketingImage(file);
  if (!validation.ok) return { ok: false, error: validation.error };

  const { path, error } = await uploadInstallPhoto(supabase, file);
  if (error || !path) {
    return { ok: false, error: `Could not upload the photo: ${error ?? "unknown error"}` };
  }
  const url = installPhotoPublicUrl(supabase, path);
  if (!url) return { ok: false, error: "Photo uploaded but its public URL could not be resolved." };

  return { ok: true, path, url };
}

/**
 * A single optional field (url) — plain ScalarForm, same as site_meta /
 * contact_info / about_story. An empty string is valid (no booking button
 * renders); a non-empty value must be a well-formed http(s) URL
 * (isValidConsultationBookingEditable — lib/site-content-db/validation.ts).
 */
export async function saveConsultationBooking(
  _prevState: SaveSectionResult,
  formData: FormData
): Promise<SaveSectionResult> {
  const value = { url: str(formData.get("url")) };
  if (!isValidConsultationBookingEditable(value)) {
    return { ok: false, error: "Enter a valid http:// or https:// URL, or leave this blank." };
  }
  return saveSection("consultation_booking", value, reasonFromFormData(formData));
}

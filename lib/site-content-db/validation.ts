/**
 * Pure shape-validation + fallback-resolution logic for the Phase 3A
 * site-content editor (no I/O — testable without a DB, mirroring
 * lib/item-groups.ts / lib/invoices/paymentInstructionsCore.ts's "pure core
 * + thin I/O wrapper" split, per Veridan_Phase3_Plan_v1.md §6 Layer 1).
 *
 * Two jobs, deliberately kept together since they're two sides of the same
 * coin:
 *  1. `isValid*` — type-guards used by both the admin save actions (reject a
 *     malformed submission before it's written) and the loader (treat a
 *     malformed/legacy DB row as if it were missing).
 *  2. `resolve*` — given a raw (possibly invalid/missing) DB value and the
 *     matching lib/site-content.ts fallback constant, returns the shape a
 *     marketing component actually renders. Falls back to the constant
 *     VERBATIM whenever the DB value doesn't validate — this is the
 *     fallback discipline the Layer 2 review checks (Plan §6: "Does every
 *     marketing page render identical output when the DB is unreachable or
 *     a row is missing?"). Missing row, Supabase error, and invalid shape
 *     all collapse to the same "pass undefined in" path from the loader, so
 *     there is exactly one fallback code path to review, not three.
 */

import type {
  SiteMeta,
  ContactInfo,
  ContactInfoEditable,
  BrandsSuppliedEditable,
  TrustSignalsEditable,
  TestimonialsEditable,
  ServiceLinesEditable,
  ProductCategoriesEditable,
  FoundersEditable,
  AboutStoryEditable,
  InstallGalleryEditable,
  ConsultationBookingEditable,
} from "./types";
// Relative import (not the "@/..." alias) — same vitest runtime-import
// constraint noted in the file header above and in lib/item-groups.ts.
import { normalizeBrandsSupplied } from "../brands/normalize";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// site_meta
// ---------------------------------------------------------------------------
export function isValidSiteMetaEditable(
  v: unknown
): v is Pick<SiteMeta, "tagline" | "positioning" | "description" | "locality"> {
  if (!isPlainObject(v)) return false;
  return (
    isNonEmptyString(v.tagline) &&
    isNonEmptyString(v.positioning) &&
    isNonEmptyString(v.description) &&
    isNonEmptyString(v.locality)
  );
}

/**
 * Merges the DB-editable fields into the fallback's full shape. Structural
 * fields (name, legalName, wordmark, domain, siteUrl) are never read from
 * the DB (Plan §1.4) — they always come from the fallback constant, DB row
 * present or not.
 */
export function resolveSiteMeta(raw: unknown, fallback: SiteMeta): SiteMeta {
  if (!isValidSiteMetaEditable(raw)) return fallback;
  return {
    ...fallback,
    tagline: raw.tagline,
    positioning: raw.positioning,
    description: raw.description,
    locality: raw.locality,
  };
}

// ---------------------------------------------------------------------------
// contact_info
// ---------------------------------------------------------------------------
export function isValidContactInfoEditable(v: unknown): v is ContactInfoEditable {
  if (!isPlainObject(v)) return false;
  // phone is optional (see types.ts) — a legacy row simply won't have the
  // key yet, and that's valid; if present it just has to be a string (an
  // admin clearing it back to "" is treated as "missing" by resolve below,
  // not as an invalid shape).
  return (
    isNonEmptyString(v.email) &&
    isNonEmptyString(v.whatsappBusinessLabel) &&
    isNonEmptyString(v.whatsappBusinessNote) &&
    isNonEmptyString(v.location) &&
    (v.phone === undefined || isString(v.phone))
  );
}

export function resolveContactInfo(raw: unknown, fallback: ContactInfo): ContactInfo {
  if (!isValidContactInfoEditable(raw)) return fallback;
  return {
    email: raw.email,
    whatsappBusinessLabel: raw.whatsappBusinessLabel,
    whatsappBusinessNote: raw.whatsappBusinessNote,
    location: raw.location,
    phone: isNonEmptyString(raw.phone) ? raw.phone : fallback.phone,
  };
}

// ---------------------------------------------------------------------------
// brands_supplied — Marketing frameworks build (2026-08-05), Framework A:
// now accepts EITHER the original plain-string[] shape (UAT §6.1 item 4:
// removing every brand must gracefully empty the brand strip, not fall back
// to the hardcoded list — still true, an empty array is valid) OR the new
// Array<{ name; logo_path? }> shape with an optional per-brand logo.
// normalizeBrandsSupplied (lib/brands/normalize.ts) is the single place
// that understands both shapes; both isValid and resolve delegate to it so
// there is exactly one normalization code path to review, matching this
// file's usual "one fallback path, not three" discipline.
// ---------------------------------------------------------------------------
export function isValidBrandsSuppliedEditable(v: unknown): v is BrandsSuppliedEditable {
  return normalizeBrandsSupplied(v) !== null;
}

/**
 * Always returns the normalized `BrandEntry[]` shape ({ name, logoPath }),
 * regardless of whether `raw` used the legacy string[] shape or the new
 * object shape — this is the shape every marketing component and the admin
 * editor actually consumes. `fallback` is always lib/site-content.ts's
 * `brandsSupplied` (a plain string[] of names, by design — see that file's
 * "Marketing frameworks" comment), normalized the same way.
 */
export function resolveBrandsSupplied(
  raw: unknown,
  fallback: readonly string[]
): BrandsSuppliedEditable {
  const normalizedRaw = normalizeBrandsSupplied(raw);
  if (normalizedRaw !== null) return normalizedRaw;
  // fallback is always valid by construction (a non-empty list of plain
  // brand-name strings), so this never falls through to `[]` in practice —
  // the `?? []` is a type-level safety net only.
  return normalizeBrandsSupplied([...fallback]) ?? [];
}

// ---------------------------------------------------------------------------
// trust_signals — array of {title, body}. Empty array allowed (a founder
// may legitimately clear this section).
// ---------------------------------------------------------------------------
export function isValidTrustSignalsEditable(v: unknown): v is TrustSignalsEditable {
  if (!Array.isArray(v)) return false;
  return v.every(
    (item) => isPlainObject(item) && isNonEmptyString(item.title) && isNonEmptyString(item.body)
  );
}

export function resolveTrustSignals(
  raw: unknown,
  fallback: TrustSignalsEditable
): TrustSignalsEditable {
  if (!isValidTrustSignalsEditable(raw)) return fallback;
  return raw;
}

// ---------------------------------------------------------------------------
// testimonials — array of {quote, attribution}. Empty array is the seeded
// default (Plan §1.4: "testimonials (seeded empty, matching today)").
// ---------------------------------------------------------------------------
export function isValidTestimonialsEditable(v: unknown): v is TestimonialsEditable {
  if (!Array.isArray(v)) return false;
  return v.every(
    (item) =>
      isPlainObject(item) && isNonEmptyString(item.quote) && isNonEmptyString(item.attribution)
  );
}

export function resolveTestimonials(
  raw: unknown,
  fallback: TestimonialsEditable
): TestimonialsEditable {
  if (!isValidTestimonialsEditable(raw)) return fallback;
  return raw;
}

// ---------------------------------------------------------------------------
// service_lines — array of {key, title, href, summary}. `href` must be a
// site-relative path (starts with "/") — a sanity check, not full routing
// validation, since this field is content-editable per Plan §1.4 (unlike
// navLinks/primaryCta, which are excluded from the DB set entirely).
// ---------------------------------------------------------------------------
export function isValidServiceLinesEditable(v: unknown): v is ServiceLinesEditable {
  if (!Array.isArray(v)) return false;
  return v.every(
    (item) =>
      isPlainObject(item) &&
      isNonEmptyString(item.key) &&
      isNonEmptyString(item.title) &&
      isNonEmptyString(item.href) &&
      item.href.startsWith("/") &&
      isNonEmptyString(item.summary)
  );
}

export function resolveServiceLines(
  raw: unknown,
  fallback: ServiceLinesEditable
): ServiceLinesEditable {
  if (!isValidServiceLinesEditable(raw)) return fallback;
  return raw;
}

// ---------------------------------------------------------------------------
// product_categories — array of {key, title, description, brands: string[]}.
// `brands` may be empty (the seeded "signage" category has no brands).
// ---------------------------------------------------------------------------
export function isValidProductCategoriesEditable(
  v: unknown
): v is ProductCategoriesEditable {
  if (!Array.isArray(v)) return false;
  return v.every(
    (item) =>
      isPlainObject(item) &&
      isNonEmptyString(item.key) &&
      isNonEmptyString(item.title) &&
      isNonEmptyString(item.description) &&
      Array.isArray(item.brands) &&
      item.brands.every((b) => isString(b))
  );
}

export function resolveProductCategories(
  raw: unknown,
  fallback: ProductCategoriesEditable
): ProductCategoriesEditable {
  if (!isValidProductCategoriesEditable(raw)) return fallback;
  return raw;
}

// ---------------------------------------------------------------------------
// founders — array of {name, role, bio}.
// ---------------------------------------------------------------------------
export function isValidFoundersEditable(v: unknown): v is FoundersEditable {
  if (!Array.isArray(v)) return false;
  return v.every(
    (item) =>
      isPlainObject(item) &&
      isNonEmptyString(item.name) &&
      isNonEmptyString(item.role) &&
      isNonEmptyString(item.bio)
  );
}

export function resolveFounders(raw: unknown, fallback: FoundersEditable): FoundersEditable {
  if (!isValidFoundersEditable(raw)) return fallback;
  return raw;
}

// ---------------------------------------------------------------------------
// about_story — {heading, body: string[]}. `body` must have at least one
// non-empty paragraph.
// ---------------------------------------------------------------------------
export function isValidAboutStoryEditable(v: unknown): v is AboutStoryEditable {
  if (!isPlainObject(v)) return false;
  return (
    isNonEmptyString(v.heading) &&
    Array.isArray(v.body) &&
    v.body.length > 0 &&
    v.body.every((p) => isNonEmptyString(p))
  );
}

export function resolveAboutStory(
  raw: unknown,
  fallback: AboutStoryEditable
): AboutStoryEditable {
  if (!isValidAboutStoryEditable(raw)) return fallback;
  return raw;
}

// ---------------------------------------------------------------------------
// install_gallery — Marketing frameworks build (2026-08-05), Framework B:
// array of {image_path, caption?}. Empty array is the seeded default (same
// "founder-populates-it-later" discipline as testimonials) — the public "Our
// Work" section on the home page renders only when this is non-empty.
// ---------------------------------------------------------------------------
export function isValidInstallGalleryEditable(v: unknown): v is InstallGalleryEditable {
  if (!Array.isArray(v)) return false;
  return v.every(
    (item) =>
      isPlainObject(item) &&
      isNonEmptyString(item.image_path) &&
      (item.caption === undefined || isString(item.caption))
  );
}

export function resolveInstallGallery(
  raw: unknown,
  fallback: InstallGalleryEditable
): InstallGalleryEditable {
  if (!isValidInstallGalleryEditable(raw)) return fallback;
  return raw;
}

// ---------------------------------------------------------------------------
// consultation_booking — Marketing frameworks build (2026-08-05),
// Framework C: {url}. Empty string is valid and is the seeded default — no
// "Book a Consultation" button renders anywhere until a founder pastes a
// real URL. A non-empty value must be a well-formed http(s) URL (a
// Microsoft Bookings link, per the brief) — this is the one section in this
// file whose "valid" set includes a format check beyond non-empty-string,
// since an admin-typed URL that isn't a URL at all would otherwise ship a
// broken external link on two public pages (Contact, home page CTA).
// ---------------------------------------------------------------------------
function isHttpUrl(v: string): boolean {
  try {
    const parsed = new URL(v);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidConsultationBookingEditable(
  v: unknown
): v is ConsultationBookingEditable {
  if (!isPlainObject(v) || !isString(v.url)) return false;
  const trimmed = v.url.trim();
  return trimmed === "" || isHttpUrl(trimmed);
}

export function resolveConsultationBooking(
  raw: unknown,
  fallback: ConsultationBookingEditable
): ConsultationBookingEditable {
  if (!isValidConsultationBookingEditable(raw)) return fallback;
  return { url: raw.url.trim() };
}

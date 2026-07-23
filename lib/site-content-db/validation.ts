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
  BrandsSuppliedEditable,
  TrustSignalsEditable,
  TestimonialsEditable,
  ServiceLinesEditable,
  ProductCategoriesEditable,
  FoundersEditable,
  AboutStoryEditable,
} from "./types";

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
export function isValidContactInfoEditable(v: unknown): v is ContactInfo {
  if (!isPlainObject(v)) return false;
  return (
    isNonEmptyString(v.email) &&
    isNonEmptyString(v.whatsappBusinessLabel) &&
    isNonEmptyString(v.whatsappBusinessNote) &&
    isNonEmptyString(v.location)
  );
}

export function resolveContactInfo(raw: unknown, fallback: ContactInfo): ContactInfo {
  if (!isValidContactInfoEditable(raw)) return fallback;
  return {
    email: raw.email,
    whatsappBusinessLabel: raw.whatsappBusinessLabel,
    whatsappBusinessNote: raw.whatsappBusinessNote,
    location: raw.location,
  };
}

// ---------------------------------------------------------------------------
// brands_supplied — array of plain strings. Empty array is valid (UAT §6.1
// item 4: removing every brand must gracefully empty the brand strip, not
// fall back to the hardcoded list).
// ---------------------------------------------------------------------------
export function isValidBrandsSuppliedEditable(v: unknown): v is BrandsSuppliedEditable {
  return Array.isArray(v) && v.every((item) => isNonEmptyString(item));
}

export function resolveBrandsSupplied(
  raw: unknown,
  fallback: readonly string[]
): BrandsSuppliedEditable {
  if (!isValidBrandsSuppliedEditable(raw)) return [...fallback];
  return raw;
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

/**
 * Types for the Phase 3A site-content editor (Veridan_Phase3_Plan_v1.md
 * §1.4/§1.5). Type-only imports from lib/site-content.ts below are erased at
 * compile time (no runtime import), so this file stays free of the
 * "@/..." runtime-alias restriction that applies to vitest (see
 * lib/item-groups.ts's comment on the same subject).
 *
 * `Widen` strips both the `readonly`-ness AND the string/number/boolean
 * *literal* narrowing that lib/site-content.ts's `as const` constants carry
 * (e.g. `"Kingston, Jamaica"` narrows to that exact literal type, not
 * `string`) — admin-edited values obviously aren't restricted to today's
 * literal text, so the DB-backed "full" types below widen back to the
 * ordinary mutable primitive types components already expect. This keeps
 * the file's own header commitment ("keeping the same shapes so components
 * don't need to change") true at the type level, not just by convention.
 */

import type {
  siteMeta,
  contactInfo,
  brandsSupplied,
  trustSignals,
  testimonials,
  serviceLines,
  productCategories,
  founders,
  aboutStory,
} from "@/lib/site-content";

type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer U)[]
        ? Widen<U>[]
        : T extends object
          ? { -readonly [K in keyof T]: Widen<T[K]> }
          : T;

/** The 9 sections migrated to `site_content` (Plan §1.4). Order matches the seed migration. */
export const SITE_CONTENT_KEYS = [
  "site_meta",
  "contact_info",
  "brands_supplied",
  "trust_signals",
  "testimonials",
  "service_lines",
  "product_categories",
  "founders",
  "about_story",
] as const;

export type SiteContentKey = (typeof SITE_CONTENT_KEYS)[number];

// ---------------------------------------------------------------------------
// "Full" shapes — identical to the lib/site-content.ts constants' types.
// These are what the loader (lib/site-content-db/loader.ts) returns, and
// what marketing components consume.
// ---------------------------------------------------------------------------
export type SiteMeta = Widen<typeof siteMeta>;
export type ContactInfo = Widen<typeof contactInfo>;
export type BrandsSupplied = Widen<typeof brandsSupplied>;
export type TrustSignal = Widen<typeof trustSignals>[number];
export type TrustSignals = Widen<typeof trustSignals>;
export type Testimonial = Widen<typeof testimonials>[number];
export type Testimonials = Widen<typeof testimonials>;
export type ServiceLine = Widen<typeof serviceLines>[number];
export type ServiceLines = Widen<typeof serviceLines>;
export type ProductCategory = Widen<typeof productCategories>[number];
export type ProductCategories = Widen<typeof productCategories>;
export type Founder = Widen<typeof founders>[number];
export type Founders = Widen<typeof founders>;
export type AboutStory = Widen<typeof aboutStory>;

// ---------------------------------------------------------------------------
// "Editable" shapes — the subset of each full shape actually stored in and
// read back from `site_content.value.value` (Plan §1.4). For most list
// sections this is the whole item shape; for site_meta it is a strict
// subset (structural fields name/legalName/wordmark/domain/siteUrl are
// never DB-editable — Plan §1.4's explicit field list); for contact_info it
// happens to be every field.
// ---------------------------------------------------------------------------
export type SiteMetaEditable = Pick<
  SiteMeta,
  "tagline" | "positioning" | "description" | "locality"
>;
export type ContactInfoEditable = ContactInfo;
export type BrandsSuppliedEditable = BrandsSupplied;
export type TrustSignalEditable = TrustSignal;
export type TrustSignalsEditable = TrustSignal[];
export type TestimonialEditable = Testimonial;
export type TestimonialsEditable = Testimonial[];
export type ServiceLineEditable = ServiceLine;
export type ServiceLinesEditable = ServiceLine[];
export type ProductCategoryEditable = ProductCategory;
export type ProductCategoriesEditable = ProductCategory[];
export type FounderEditable = Founder;
export type FoundersEditable = Founder[];
export type AboutStoryEditable = AboutStory;

/** The jsonb envelope shape stored in site_content.value (mirrors business_parameters.value). */
export interface SiteContentValueEnvelope<T> {
  type: "table";
  value: T;
}

/** Row shape for admin reads (matches the migration's columns). */
export interface SiteContentRow {
  key: SiteContentKey;
  value: SiteContentValueEnvelope<unknown>;
  value_type: "table";
  section_label: string;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface SiteContentAuditLogRow {
  id: string;
  content_key: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
}

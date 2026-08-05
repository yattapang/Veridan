import "server-only";

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
// Cookie-FREE anon client on purpose: a cookie-bound client would force every
// marketing route to render dynamically (Phase 3A review MAJOR-1). site_content
// is public and session-independent, so this keeps the pages statically
// prerenderable while unstable_cache + revalidateTag handle freshness.
import { createPublicContentClient } from "@/lib/supabase/publicClient";
import {
  siteMeta as siteMetaFallback,
  contactInfo as contactInfoFallback,
  brandsSupplied as brandsSuppliedFallback,
  trustSignals as trustSignalsFallback,
  testimonials as testimonialsFallback,
  serviceLines as serviceLinesFallback,
  productCategories as productCategoriesFallback,
  founders as foundersFallback,
  aboutStory as aboutStoryFallback,
  installGallery as installGalleryFallback,
  consultationBooking as consultationBookingFallback,
} from "@/lib/site-content";
import {
  resolveSiteMeta,
  resolveContactInfo,
  resolveBrandsSupplied,
  resolveTrustSignals,
  resolveTestimonials,
  resolveServiceLines,
  resolveProductCategories,
  resolveFounders,
  resolveAboutStory,
  resolveInstallGallery,
  resolveConsultationBooking,
} from "./validation";
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
  InstallGalleryEditable,
  ConsultationBookingEditable,
  SiteContentKey,
} from "./types";

/**
 * Per-section loader functions (Plan §1.5) — one exported async function per
 * `site_content` row, each:
 *   1. Reads the row via the request-scoped `createClient()` (anon-key,
 *      RLS-enforced) — correct for both public marketing pages (anon role,
 *      site_content_anon_select) and a signed-in founder transparently
 *      previewing (authenticated role, site_content_founder_all covers
 *      SELECT too; same row either way, since every site_content row is
 *      public by construction).
 *   2. Falls back to the matching lib/site-content.ts constant, verbatim,
 *      on a missing row, a Supabase error, OR an invalid/legacy shape —
 *      see lib/site-content-db/validation.ts's resolve* functions, which do
 *      the actual fallback-vs-DB-value decision as a pure, unit-tested
 *      function. This file's job is only the I/O.
 *   3. Wraps the query in `unstable_cache` (tags: [`site-content:<key>`],
 *      revalidate: 3600s) — the correct primitive under this repo's
 *      *previous* caching model (cacheComponents is OFF; see AGENTS.md
 *      instruction to check node_modules/next/dist/docs before writing
 *      caching code, and Veridan_Phase3_Plan_v1.md's "reality check"
 *      section, which confirms this against next@16.2.10's own docs).
 *
 * A deliberate note on `unstable_cache` + a cookie-bound client: Next's own
 * docs warn against calling `cookies()`/`headers()` *inside* a cache scope,
 * recommending those be resolved outside and passed in. That's exactly
 * what happens here — `createClient()` (which awaits `cookies()`) runs
 * BEFORE `unstable_cache(...)` is invoked, not inside the cached callback;
 * the callback only closes over the already-resolved client. This is safe
 * specifically because `site_content` reads are not user-scoped: the query
 * result is identical for every caller (anon visitor or signed-in founder)
 * by construction (every row is public marketing copy, single anon-select
 * policy, no per-user branching) — so which request happened to trigger a
 * given cache-key's population is incidental, not a correctness risk the
 * way it would be for genuinely per-user data.
 * 4. The `/admin/content` save actions call `revalidateTag` on success —
 *    see app/admin/content/actions.ts.
 */

async function fetchSectionValue(
  supabase: SupabaseClient,
  key: SiteContentKey
): Promise<unknown> {
  try {
    const { data, error } = await supabase
      .from("site_content")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error || !data) return undefined;

    const envelope = data.value as { value?: unknown } | null;
    return envelope?.value;
  } catch {
    // Unreachable Supabase / network failure — treated identically to a
    // missing row by every resolve* function (UAT §6.1 item 5).
    return undefined;
  }
}

/**
 * `F` defaults to `T` (every original Phase 3A section resolves and falls
 * back with the same shape). `brands_supplied` (Marketing frameworks build,
 * Framework A) is the one exception: `resolveBrandsSupplied`'s fallback
 * parameter is `readonly string[]` (lib/site-content.ts's `brandsSupplied`
 * stays plain names — see that file's comment) while its return/T is the
 * normalized `BrandEntry[]` — hence the separate `F` type param, explicitly
 * supplied at that one call site below.
 */
function makeSectionLoader<T, F = T>(
  key: SiteContentKey,
  resolve: (raw: unknown, fallback: F) => T,
  fallback: F
): () => Promise<T> {
  return async function load(): Promise<T> {
    let supabase: SupabaseClient;
    try {
      supabase = createPublicContentClient();
    } catch {
      // Supabase env vars not configured — same fallback discipline as
      // every other loader in this repo (e.g. app/admin/parameters/page.tsx).
      // Routed through `resolve` (not returned bare) so the result is
      // always shape T, not F — for every original section F=T and
      // resolve(undefined, fallback) returns fallback verbatim by
      // construction, so this is a no-op there; for brands_supplied
      // (F = readonly string[], T = BrandEntry[]) it's the one branch that
      // actually needs the normalization.
      return resolve(undefined, fallback);
    }

    const cached = unstable_cache(
      async () => fetchSectionValue(supabase, key),
      ["site-content", key],
      { tags: [`site-content:${key}`], revalidate: 3600 }
    );

    const raw = await cached();
    return resolve(raw, fallback);
  };
}

export const getSiteMeta = makeSectionLoader<SiteMeta>(
  "site_meta",
  resolveSiteMeta,
  siteMetaFallback
);

export const getContactInfo = makeSectionLoader<ContactInfo>(
  "contact_info",
  resolveContactInfo,
  contactInfoFallback
);

export const getBrandsSupplied = makeSectionLoader<BrandsSuppliedEditable, readonly string[]>(
  "brands_supplied",
  resolveBrandsSupplied,
  brandsSuppliedFallback
);

export const getTrustSignals = makeSectionLoader<TrustSignalsEditable>(
  "trust_signals",
  resolveTrustSignals,
  [...trustSignalsFallback]
);

export const getTestimonials = makeSectionLoader<TestimonialsEditable>(
  "testimonials",
  resolveTestimonials,
  [...testimonialsFallback]
);

export const getServiceLines = makeSectionLoader<ServiceLinesEditable>(
  "service_lines",
  resolveServiceLines,
  [...serviceLinesFallback]
);

export const getProductCategories = makeSectionLoader<ProductCategoriesEditable>(
  "product_categories",
  resolveProductCategories,
  productCategoriesFallback.map((c) => ({ ...c, brands: [...c.brands] }))
);

export const getFounders = makeSectionLoader<FoundersEditable>(
  "founders",
  resolveFounders,
  [...foundersFallback]
);

export const getAboutStory = makeSectionLoader<AboutStoryEditable>(
  "about_story",
  resolveAboutStory,
  { heading: aboutStoryFallback.heading, body: [...aboutStoryFallback.body] }
);

// Marketing frameworks build (2026-08-05) — Framework B / Framework C.
export const getInstallGallery = makeSectionLoader<InstallGalleryEditable>(
  "install_gallery",
  resolveInstallGallery,
  [...installGalleryFallback]
);

export const getConsultationBooking = makeSectionLoader<ConsultationBookingEditable>(
  "consultation_booking",
  resolveConsultationBooking,
  { url: consultationBookingFallback.url }
);

/**
 * Public URL for a brand logo in the public `brand-logos` bucket, or null
 * if there isn't one — same shape as lib/articles/publicLoader.ts's
 * publicHeroImageUrl (cookie-free client, no signing needed since the
 * bucket is public).
 */
export function publicBrandLogoUrl(logoPath: string | null): string | null {
  if (!logoPath) return null;
  let supabase: SupabaseClient;
  try {
    supabase = createPublicContentClient();
  } catch {
    return null;
  }
  const { data } = supabase.storage.from("brand-logos").getPublicUrl(logoPath);
  return data.publicUrl;
}

/** Public URL for an install-gallery photo in the public `install-photos` bucket, or null if there isn't one. */
export function publicInstallPhotoUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  let supabase: SupabaseClient;
  try {
    supabase = createPublicContentClient();
  } catch {
    return null;
  }
  const { data } = supabase.storage.from("install-photos").getPublicUrl(imagePath);
  return data.publicUrl;
}

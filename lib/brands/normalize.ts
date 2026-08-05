/**
 * Pure shape-normalization for the `brands_supplied` site_content section
 * (Marketing frameworks build, 2026-08-05 — "Framework A: brand logos").
 *
 * Backward compatibility requirement: `brands_supplied` has stored a plain
 * `string[]` of brand names since Phase 3A (20260722000001_site_content.sql)
 * and every marketing page + the admin editor has depended on that shape.
 * This build adds an OPTIONAL logo per brand without breaking any existing
 * row — a legacy `string[]` row must keep validating and rendering exactly
 * as it does today (text-only brand strip), and a newly-saved row may use
 * the richer `Array<{ name: string; logo_path?: string | null }>` shape.
 *
 * `normalizeBrandsSupplied` is the single place that understands both
 * shapes; every other file (validation.ts, loader.ts, the admin editor)
 * treats its output — `BrandEntry[]`, always `{ name, logoPath }` — as the
 * one true shape. Returns `null` for anything that doesn't validate as
 * either the legacy or the new shape, which the caller treats as "invalid",
 * same discipline as every other resolve* in lib/site-content-db/validation.ts.
 */

export interface BrandEntry {
  name: string;
  logoPath: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Normalizes one entry — either a legacy plain string (brand name only) or
 * the new `{ name, logo_path? }` object — into a `BrandEntry`. Returns
 * `null` if the entry matches neither shape.
 */
function normalizeEntry(item: unknown): BrandEntry | null {
  if (typeof item === "string") {
    return isNonEmptyString(item) ? { name: item.trim(), logoPath: null } : null;
  }
  if (isPlainObject(item) && isNonEmptyString(item.name)) {
    const rawLogoPath = item.logo_path;
    // `logo_path` may be omitted, null, or a string — omitted/null/"" all
    // mean "no logo" (matches the founder-facing "remove logo" action). Any
    // other type (number, object, …) is not a valid shape.
    if (rawLogoPath !== undefined && rawLogoPath !== null && typeof rawLogoPath !== "string") {
      return null;
    }
    const logoPath =
      typeof rawLogoPath === "string" && rawLogoPath.trim() !== "" ? rawLogoPath : null;
    return { name: item.name.trim(), logoPath };
  }
  return null;
}

/**
 * Normalizes a whole `brands_supplied` value (legacy `string[]` OR the new
 * `Array<{ name; logo_path? }>`, may be mixed) into `BrandEntry[]`. Returns
 * `null` if `v` isn't an array, or any entry fails to normalize — the caller
 * (isValidBrandsSuppliedEditable) treats `null` as "invalid, fall back".
 * An empty array is valid (a founder may clear every brand — same rule as
 * every other list section).
 */
export function normalizeBrandsSupplied(v: unknown): BrandEntry[] | null {
  if (!Array.isArray(v)) return null;
  const result: BrandEntry[] = [];
  for (const item of v) {
    const entry = normalizeEntry(item);
    if (entry === null) return null;
    result.push(entry);
  }
  return result;
}

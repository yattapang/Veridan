/**
 * Pure helpers shared by the two admin-managed taxonomies added 2026-08-07
 * (founder feedback: company types and product categories both need
 * create/rename/delete, not a fixed CHECK-constrained list) — see
 * supabase/migrations/20260807000001_managed_taxonomies.sql,
 * app/admin/companies/types/, and app/admin/products/categories/.
 *
 * Both `company_types` and `product_categories_admin` share the same
 * {name, label, sort_order} shape (name = the stored value written to
 * companies.type / products.generic_category; label = what the UI
 * displays), so the validation/usage-counting/option-building logic is
 * written once here instead of duplicated per taxonomy — mirrors
 * lib/articles/categoryAdmin.ts's role for article_categories, generalized
 * since neither taxonomy here needs a URL slug.
 *
 * Kept dependency-free (no Supabase client) so it's unit-testable in
 * isolation; the actual I/O lives in the two actions.ts files.
 */

export interface TaxonomyNameCandidate {
  id: string;
  name: string;
  label: string;
}

/**
 * Derives the stored `name` value from a founder-typed label, e.g.
 * "Facilities Management" -> "facilities_management". Lowercase,
 * underscore-separated (matching the seeded values' snake_case style, e.g.
 * 'supplier_contact'), punctuation stripped.
 */
export function deriveTaxonomyName(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export type TaxonomyLabelValidationResult =
  | { ok: true; name: string; label: string }
  | { ok: false; error: string };

/**
 * Validates a new/renamed label against the entries that already exist,
 * returning the trimmed label + derived stored name on success, or a
 * friendly error naming exactly what collided. `excludeId` lets a rename
 * check against every OTHER entry (the row being renamed doesn't collide
 * with itself) — same convention as lib/articles/categoryAdmin.ts's
 * validateCategoryName.
 */
export function validateTaxonomyLabel(
  label: string,
  existing: TaxonomyNameCandidate[],
  excludeId?: string
): TaxonomyLabelValidationResult {
  const trimmed = label.trim();
  if (!trimmed) {
    return { ok: false, error: "Label is required." };
  }

  const others = excludeId ? existing.filter((c) => c.id !== excludeId) : existing;
  const normalized = trimmed.toLowerCase();

  const labelCollision = others.find((c) => c.label.trim().toLowerCase() === normalized);
  if (labelCollision) {
    return { ok: false, error: `"${labelCollision.label}" already exists.` };
  }

  const name = deriveTaxonomyName(trimmed);
  if (!name) {
    return { ok: false, error: "Enter a label with at least one letter or number." };
  }

  const nameCollision = others.find((c) => c.name === name);
  if (nameCollision) {
    return {
      ok: false,
      error: `"${trimmed}" produces the same stored value ("${name}") as "${nameCollision.label}". Choose a slightly different label.`,
    };
  }

  return { ok: true, name, label: trimmed };
}

/**
 * Usage counts, keyed by the EXACT stored value (e.g. companies.type or
 * products.generic_category) — the picker always writes a managed entry's
 * `name` verbatim, so an exact match is the correct comparison. Blank/null
 * values are ignored.
 */
export function computeTaxonomyUsageCounts(values: (string | null)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** Usage count for one stored value — 0 when nothing currently uses it. */
export function usageCountFor(name: string, counts: Map<string, number>): number {
  return counts.get(name) ?? 0;
}

export interface TaxonomyOption {
  /** What gets written to the record's column — the managed entry's `name`, or the legacy/custom value verbatim. */
  value: string;
  label: string;
  isCustom: boolean;
}

/**
 * Builds the option list for a taxonomy picker: every managed entry, PLUS —
 * if the record's current value isn't (or is no longer) among them — that
 * value appended as a labelled "custom" option so it stays selected and
 * saving the form never silently changes it. `currentValue` is the
 * record's existing column value (may be null/blank for a new record, in
 * which case no custom option is added). Mirrors lib/articles/
 * categoryAdmin.ts's buildCategoryOptions.
 */
export function buildTaxonomyOptions(
  managed: { name: string; label: string }[],
  currentValue: string | null | undefined
): TaxonomyOption[] {
  const options: TaxonomyOption[] = managed.map((m) => ({
    value: m.name,
    label: m.label,
    isCustom: false,
  }));

  const trimmedCurrent = currentValue?.trim();
  if (trimmedCurrent && !managed.some((m) => m.name === trimmedCurrent)) {
    options.push({
      value: trimmedCurrent,
      label: `${trimmedCurrent} (custom — not in the managed list)`,
      isCustom: true,
    });
  }

  return options;
}

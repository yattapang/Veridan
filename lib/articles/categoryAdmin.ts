import { slugify } from "./slug";

/**
 * Pure helpers for the admin-managed article category list (founder
 * decision 2026-08-06 — see supabase/migrations/20260806000001_article_
 * categories.sql). Kept dependency-free (no Supabase client) so the
 * validation/merge/ordering rules are unit-testable in isolation, mirroring
 * lib/item-groups.ts and lib/articles/slug.ts. The actual I/O (reading and
 * writing article_categories, revalidation) lives in
 * app/admin/articles/categories/actions.ts.
 *
 * Minimal structural types (not the full ArticleCategoryRow) are used
 * throughout so this module stays decoupled from lib/supabase/types.ts —
 * every function only needs a handful of fields off a category row.
 */

export interface CategoryNameCandidate {
  id: string;
  name: string;
  slug: string;
}

/** A category name → URL-safe slug, using the same rules as article slugs (lib/articles/slug.ts). */
export function deriveCategorySlug(name: string): string {
  return slugify(name);
}

export type CategoryNameValidationResult =
  | { ok: true; name: string; slug: string }
  | { ok: false; error: string };

/**
 * Validates a category name against the categories that already exist,
 * returning the trimmed name + derived slug on success, or a friendly error
 * naming exactly what collided. `excludeId` lets a rename check against
 * every OTHER category (the row being renamed doesn't collide with itself).
 *
 * Per the founder's ask ("uniqueness enforced with a friendly error"), a
 * slug collision is surfaced as an error rather than silently appended
 * with a numeric suffix (unlike article slugs in lib/articles/slug.ts,
 * where founders edit a URL directly) — a category name is short and a
 * founder can simply pick a different one.
 */
export function validateCategoryName(
  name: string,
  existing: CategoryNameCandidate[],
  excludeId?: string
): CategoryNameValidationResult {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: "Name is required." };
  }

  const others = excludeId ? existing.filter((c) => c.id !== excludeId) : existing;
  const normalized = trimmed.toLowerCase();

  const nameCollision = others.find((c) => c.name.trim().toLowerCase() === normalized);
  if (nameCollision) {
    return { ok: false, error: `A category named "${nameCollision.name}" already exists.` };
  }

  const slug = deriveCategorySlug(trimmed);
  const slugCollision = others.find((c) => c.slug === slug);
  if (slugCollision) {
    return {
      ok: false,
      error: `"${trimmed}" produces the same URL slug ("${slug}") as "${slugCollision.name}". Choose a slightly different name.`,
    };
  }

  return { ok: true, name: trimmed, slug };
}

/**
 * Usage counts, keyed by the EXACT category string as stored on
 * articles.category (case-sensitive, no trimming beyond what's already in
 * the data) — the editor's dropdown always writes a managed category's
 * `name` verbatim, so an exact match is the correct comparison. Articles
 * with a null/blank category are ignored.
 */
export function computeCategoryUsageCounts(
  articles: { category: string | null }[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const article of articles) {
    if (!article.category) continue;
    counts.set(article.category, (counts.get(article.category) ?? 0) + 1);
  }
  return counts;
}

/** Usage count for one category name — 0 when it's not used by any article. */
export function usageCountFor(categoryName: string, counts: Map<string, number>): number {
  return counts.get(categoryName) ?? 0;
}

export interface CategoryOption {
  /** What gets written to articles.category — the managed category's `name`, or the legacy/custom value verbatim. */
  value: string;
  label: string;
  isCustom: boolean;
}

/**
 * Builds the option list for the article editor's category dropdown: every
 * managed category, PLUS — if the article's current category isn't (or is
 * no longer) among them — that value appended as a labelled "custom" option
 * so it stays selected and saving the form never silently changes it.
 * `currentValue` is the article's existing `category` column value (may be
 * null/blank for a new or never-categorized article, in which case no
 * custom option is added).
 */
export function buildCategoryOptions(
  managed: { name: string }[],
  currentValue: string | null | undefined
): CategoryOption[] {
  const options: CategoryOption[] = managed.map((c) => ({
    value: c.name,
    label: c.name,
    isCustom: false,
  }));

  const trimmedCurrent = currentValue?.trim();
  if (trimmedCurrent && !managed.some((c) => c.name === trimmedCurrent)) {
    options.push({
      value: trimmedCurrent,
      label: `${trimmedCurrent} (custom — not in the managed list)`,
      isCustom: true,
    });
  }

  return options;
}

/**
 * Orders a set of category strings actually IN USE on published articles
 * (public /articles page filter chips) by the managed list's sort_order
 * first, falling back to alphabetical for any in-use value that isn't (or
 * is no longer) a managed category — e.g. a legacy/custom value on an old
 * article, or every value when the managed table is unreachable/empty and
 * the caller passed an empty `managed` array.
 */
export function orderCategoriesForPublicFilter(
  inUseCategories: string[],
  managed: { name: string; sort_order: number }[]
): string[] {
  const sortOrderByName = new Map(managed.map((c) => [c.name, c.sort_order]));

  return [...inUseCategories].sort((a, b) => {
    const orderA = sortOrderByName.get(a) ?? Number.POSITIVE_INFINITY;
    const orderB = sortOrderByName.get(b) ?? Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b);
  });
}

export interface SortableCategory {
  id: string;
  sort_order: number;
}

/**
 * Given categories already ordered by sort_order ascending (the order the
 * admin list renders in), returns the two `{id, sort_order}` pairs to
 * persist so that moving `id` one step `"up"` or `"down"` swaps it with its
 * immediate neighbor in that list — or `null` if `id` is already at that
 * end (nothing to swap). Deliberately swaps whatever pair is adjacent in
 * the passed-in order rather than doing arithmetic on the numbers
 * themselves, so it stays correct even if two rows happen to share a
 * sort_order value.
 */
export function swapSortOrder(
  categoriesSortedAsc: SortableCategory[],
  id: string,
  direction: "up" | "down"
): { id: string; sort_order: number }[] | null {
  const index = categoriesSortedAsc.findIndex((c) => c.id === id);
  if (index === -1) return null;

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= categoriesSortedAsc.length) return null;

  const current = categoriesSortedAsc[index];
  const target = categoriesSortedAsc[targetIndex];

  return [
    { id: current.id, sort_order: target.sort_order },
    { id: target.id, sort_order: current.sort_order },
  ];
}

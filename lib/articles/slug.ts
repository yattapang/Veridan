/**
 * Phase 3B — pure slug helpers for the article editor (Plan §2.4: "slug
 * (auto-generated from title, editable, unique-checked against the existing
 * `slug` unique constraint)"). Kept free of any Supabase/DB import so the
 * generation + collision-handling rules are unit-testable in isolation; the
 * actual uniqueness CHECK against the database happens in
 * app/admin/articles/actions.ts, which calls nextAvailableSlug with the set
 * of slugs already in use.
 */

const FALLBACK_SLUG = "article";
const MAX_SLUG_LENGTH = 96;

// Combining marks (Unicode general category M) left behind by NFKD
// normalization, e.g. an accented "e" becomes "e" + a separate combining
// accent codepoint. \p{M} with the "u" flag matches the whole Mark
// category, so this needs no hand-picked codepoint range.
const COMBINING_DIACRITICS_RE = /\p{M}/gu;
// Curly/straight apostrophes (U+2018, U+2019, U+0027) - dropped rather than
// turned into hyphens so "Architect's Guide" slugifies to
// "architects-guide", not "architect-s-guide".
const APOSTROPHE_RE = /[‘’']/g;

/**
 * Slugify a title into a URL-safe, lowercase, hyphenated slug: strips
 * diacritics, drops anything that isn't a-z/0-9, collapses runs of
 * separators into a single hyphen, and trims leading/trailing hyphens.
 * Falls back to "article" if the input has no sluggable characters at all
 * (e.g. a title that's only punctuation or emoji).
 */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS_RE, "")
    .toLowerCase()
    .replace(APOSTROPHE_RE, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, ""); // a slice() can leave a trailing hyphen mid-word

  return slug.length > 0 ? slug : FALLBACK_SLUG;
}

/**
 * Given a desired base slug and the set of slugs already taken (by every
 * OTHER article — the caller excludes the article being edited, if any),
 * returns the base slug itself if free, or the first `${base}-2`,
 * `${base}-3`, … variant that is free. Pure and deterministic — the caller
 * re-derives `taken` fresh from the database on every save, so this never
 * needs to reason about races itself (the DB's `unique` constraint on
 * `articles.slug` is the actual backstop against a concurrent collision).
 */
export function nextAvailableSlug(base: string, taken: Iterable<string>): string {
  const takenSet = taken instanceof Set ? taken : new Set(taken);
  const root = base.length > 0 ? base : FALLBACK_SLUG;

  if (!takenSet.has(root)) return root;

  let n = 2;
  while (takenSet.has(`${root}-${n}`)) {
    n += 1;
  }
  return `${root}-${n}`;
}

/** True if `value` is already a well-formed slug (useful for validating a founder's manual edit). */
export function isWellFormedSlug(value: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= MAX_SLUG_LENGTH;
}

/**
 * Phase 3B — curated, education-led article categories (founder decision
 * 2026-07-23, resolving Plan §8 open question 3): the Jamaican market
 * doesn't yet understand hardware specs/grades, so educational categories
 * lead the list, with product-family categories after.
 *
 * `articles.category` stays a nullable free-text column (see the migration
 * comment on that column) — this list is presented as SUGGESTIONS in the
 * editor (a datalist), never enforced. A founder may type any custom
 * category. The public article list may group/filter by category using
 * whatever string value is actually stored, not just this list.
 */
export const SUGGESTED_ARTICLE_CATEGORIES = [
  // Educational, leads the list per the founder's stated reasoning.
  "Specification Guidance",
  "Understanding Grades & Certifications",
  "Fire Safety & Compliance",
  "Product Spotlights",
  "Project Stories",
  // Product-family categories.
  "Locksets & Deadbolts",
  "Door Closers",
  "Exit & Panic Hardware",
  "Hinges & Pivots",
  "Access Control",
  "Architectural Ironmongery",
] as const;

export type SuggestedArticleCategory = (typeof SUGGESTED_ARTICLE_CATEGORIES)[number];

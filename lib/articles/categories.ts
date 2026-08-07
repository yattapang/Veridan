/**
 * Fallback article category list — founder decision 2026-08-06: article
 * categories became an ADMIN-MANAGED list (create/rename/delete), backed by
 * the `article_categories` table (supabase/migrations/20260806000001_
 * article_categories.sql). That table is the source of truth for the
 * editor's category picker and the public /articles filter ordering; this
 * constant is used ONLY as a fallback when the table is unreachable or
 * empty (see lib/articles/categoriesLoader.ts), mirroring
 * lib/site-content.ts's relationship to lib/site-content-db/loader.ts.
 *
 * Contents match the migration's seed rows verbatim (name / slug /
 * description / sort_order) so the fallback never drifts from what a fresh
 * database actually contains — if you change one, change the other.
 *
 * Supersedes the Phase 3B curated-suggestion list (founder decision
 * 2026-07-23), which was a hardcoded datalist of suggestions with no
 * create/rename/delete UI. `articles.category` itself is unchanged by this
 * decision: it stays a nullable free-text column (see the migration
 * comment on that column, 20260723000001_articles_workspace.sql, and the
 * CRITICAL DESIGN CONSTRAINT note in 20260806000001_article_categories.sql)
 * — this list (managed or fallback) is presented as SELECTABLE OPTIONS in
 * the editor, plus a legacy/custom value when the article's current
 * category isn't among them (lib/articles/categoryAdmin.ts's
 * buildCategoryOptions).
 */
export interface ArticleCategorySeed {
  name: string;
  slug: string;
  description: string;
  sort_order: number;
}

export const SUGGESTED_ARTICLE_CATEGORIES: ArticleCategorySeed[] = [
  {
    name: "Hardware Fundamentals",
    slug: "hardware-fundamentals",
    description: "Ground zero: what commercial hardware is and how a door opening works.",
    sort_order: 1,
  },
  {
    name: "Grades & Standards",
    slug: "grades-standards",
    description: "ANSI/BHMA grades, cycle testing, and what certifications actually mean.",
    sort_order: 2,
  },
  {
    name: "Finishes & Materials",
    slug: "finishes-materials",
    description: "Finish codes, stainless grades, corrosion resistance, and aesthetics.",
    sort_order: 3,
  },
  {
    name: "Fire Safety & Compliance",
    slug: "fire-safety-compliance",
    description: "Fire-rated assemblies, egress, panic hardware, and inspections.",
    sort_order: 4,
  },
  {
    name: "Specifying for Jamaica",
    slug: "specifying-for-jamaica",
    description: "Salt air, humidity, hurricanes, power reliability, and hospitality.",
    sort_order: 5,
  },
  {
    name: "Cost & Value",
    slug: "cost-value",
    description: "Lifecycle cost, value-engineering risk, warranty, and liability.",
    sort_order: 6,
  },
  {
    name: "Product Spotlights",
    slug: "product-spotlights",
    description: "Deep dives on specific products and why they are specified.",
    sort_order: 7,
  },
  {
    name: "Project Stories",
    slug: "project-stories",
    description: "Real Veridan installations, start to finish.",
    sort_order: 8,
  },
];

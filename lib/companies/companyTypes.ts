/**
 * Fallback company type list — founder feedback 2026-08-07: company types
 * became an ADMIN-MANAGED list (create/rename/delete), backed by the
 * `company_types` table (supabase/migrations/20260807000001_managed_
 * taxonomies.sql). That table is the source of truth for the company
 * form's Type picker; this constant is used ONLY as a fallback when the
 * table is unreachable or empty (see lib/companies/typesLoader.ts),
 * mirroring lib/articles/categories.ts's relationship to
 * lib/articles/categoriesLoader.ts.
 *
 * Contents match the migration's seed rows verbatim (name / label /
 * sort_order) so the fallback never drifts from what a fresh database
 * actually contains — if you change one, change the other.
 *
 * `companies.type` itself is unchanged by this decision: it stays a
 * not-null free-text column (see the migration's header note) — this list
 * (managed or fallback) is presented as SELECTABLE OPTIONS in the company
 * form, plus a legacy/custom value when the company's current type isn't
 * among them (lib/taxonomies/taxonomyAdmin.ts's buildTaxonomyOptions).
 */
export interface CompanyTypeSeed {
  name: string;
  label: string;
  sort_order: number;
}

export const FALLBACK_COMPANY_TYPES: CompanyTypeSeed[] = [
  { name: "architect", label: "Architect", sort_order: 1 },
  { name: "contractor", label: "Contractor", sort_order: 2 },
  { name: "owner", label: "Owner", sort_order: 3 },
  { name: "fm", label: "Facilities Management", sort_order: 4 },
  { name: "supplier_contact", label: "Supplier contact", sort_order: 5 },
];

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { FALLBACK_COMPANY_TYPES } from "./companyTypes";
import type { CompanyTypeRow } from "@/lib/supabase/types";

export type ManagedCompanyType = Pick<CompanyTypeRow, "id" | "name" | "label" | "sort_order">;

const SELECT_COLUMNS = "id, name, label, sort_order";

/**
 * Fallback rows derived from lib/companies/companyTypes.ts, used only when
 * company_types is unreachable or empty — same DB-with-hardcoded-fallback
 * discipline as lib/articles/categoriesLoader.ts. `id` is synthesized
 * (there's no database row) but stable across calls, which is all a React
 * `key` or a <select> option value needs.
 */
const FALLBACK_ROWS: ManagedCompanyType[] = FALLBACK_COMPANY_TYPES.map((t) => ({
  id: `fallback-${t.name}`,
  name: t.name,
  label: t.label,
  sort_order: t.sort_order,
}));

/**
 * Managed company types for the admin Companies pages (list filter, create/
 * edit form's Type picker) — takes an already-created authenticated client
 * (these pages are never statically prerendered, so there's no need for a
 * separate cookie-free client like the public article-category loader
 * uses). Falls back to the hardcoded constant when the table is
 * unreachable OR returns zero rows, so the picker always has usable
 * options even if this migration hasn't been applied yet.
 */
export async function getManagedCompanyTypes(supabase: SupabaseClient): Promise<ManagedCompanyType[]> {
  try {
    const { data, error } = await supabase
      .from("company_types")
      .select(SELECT_COLUMNS)
      .order("sort_order", { ascending: true });
    if (error || !data || data.length === 0) return FALLBACK_ROWS;
    return data as ManagedCompanyType[];
  } catch {
    return FALLBACK_ROWS;
  }
}

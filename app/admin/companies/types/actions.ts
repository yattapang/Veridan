"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { validateTaxonomyLabel } from "@/lib/taxonomies/taxonomyAdmin";
import type { CompanyTypeRow } from "@/lib/supabase/types";

export type CompanyTypeActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export type CompanyTypeQuickCreateResult =
  | { ok: true; id: string; name: string; label: string; error?: undefined }
  | { ok: false; error: string };

function revalidateCompanyTypeViews() {
  revalidatePath("/admin/companies/types");
  revalidatePath("/admin/companies");
  // Every company edit page embeds the picker too, but revalidating each by
  // id isn't practical here — the form re-fetches the managed list on every
  // server render anyway (no client-side cache of it), so a stale picker is
  // at most a fresh-navigation-away, and Save always writes the company's
  // own type value regardless (same reasoning as revalidateCategoryViews in
  // app/admin/articles/categories/actions.ts).
}

async function fetchExistingCompanyTypes(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Pick<CompanyTypeRow, "id" | "name" | "label">[]> {
  const { data } = await supabase.from("company_types").select("id, name, label");
  return (data as Pick<CompanyTypeRow, "id" | "name" | "label">[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// Create — both the company types admin page's own form and the company
// form's inline "+ New type" quick-create call this.
// ---------------------------------------------------------------------------

async function createCompanyType(label: string): Promise<CompanyTypeQuickCreateResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create a company type." };

  const existing = await fetchExistingCompanyTypes(supabase);
  const validated = validateTaxonomyLabel(label, existing);
  if (!validated.ok) return validated;

  // New types sort after every existing one by default (same "keep it
  // simple" convention as article_categories — no reorder UI here).
  const { data: maxRow } = await supabase
    .from("company_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("company_types")
    .insert({ name: validated.name, label: validated.label, sort_order: nextSortOrder })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: `Could not create the company type: ${error?.message ?? "unknown error"}` };
  }

  revalidateCompanyTypeViews();
  return { ok: true, id: data.id as string, name: validated.name, label: validated.label };
}

/** Full create form on /admin/companies/types (label only — the stored name is derived). */
export async function createCompanyTypeForm(
  _prevState: CompanyTypeActionResult,
  formData: FormData
): Promise<CompanyTypeActionResult> {
  const label = String(formData.get("label") ?? "");
  const result = await createCompanyType(label);
  if (!result.ok) return result;
  return { ok: true };
}

/**
 * Inline quick-create from the company create/edit form (mirrors
 * app/admin/products/actions.ts's createItemGroupInline) — a founder can
 * add a company type without leaving the record they're working on.
 * Returns the new row's id/name/label so the calling form can select it
 * immediately.
 */
export async function createCompanyTypeInline(label: string): Promise<CompanyTypeQuickCreateResult> {
  return createCompanyType(label);
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export async function renameCompanyType(
  id: string,
  _prevState: CompanyTypeActionResult,
  formData: FormData
): Promise<CompanyTypeActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to rename a company type." };

  const label = String(formData.get("label") ?? "");

  const existing = await fetchExistingCompanyTypes(supabase);
  const validated = validateTaxonomyLabel(label, existing, id);
  if (!validated.ok) return validated;

  // Renaming ONLY updates this row (name/label). Every company that
  // currently carries the OLD stored value as its `type` keeps that exact
  // value — this deliberately does NOT cascade to companies.type (see the
  // migration's header note). A founder who wants existing companies to
  // show the new label would need to re-save each company's type
  // individually; that's out of scope here by design, not an oversight.
  const { error } = await supabase
    .from("company_types")
    .update({ name: validated.name, label: validated.label })
    .eq("id", id);

  if (error) return { ok: false, error: `Could not save the company type: ${error.message}` };

  revalidateCompanyTypeViews();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delete — hard delete of the company_types row ONLY. Never touches
// companies.type on any row (see the migration's header note) — a company
// that carried this type's stored value keeps its value verbatim; it
// simply stops appearing as a picker option for FUTURE saves. The confirm
// dialog stating the usage count lives in the client component
// (CompanyTypeListItem.tsx), which already has the count computed for
// display.
// ---------------------------------------------------------------------------

export async function deleteCompanyType(id: string): Promise<CompanyTypeActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to delete a company type." };

  const { error } = await supabase.from("company_types").delete().eq("id", id);
  if (error) return { ok: false, error: `Could not delete the company type: ${error.message}` };

  revalidateCompanyTypeViews();
  return { ok: true };
}

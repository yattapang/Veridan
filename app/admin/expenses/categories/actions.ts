"use server";

/**
 * Managed operating-expense taxonomy CRUD.
 *
 * THE DELETE RULE IS THE POINT OF THIS FILE. `expenses.expense_category_id`
 * is a real FK with ON DELETE RESTRICT, so a category that is in use CANNOT
 * be deleted. Rather than letting Postgres reject it and surfacing a raw
 * "violates foreign key constraint expenses_expense_category_id_fkey"
 * string, `deleteExpenseCategory` counts the referencing rows first and
 * returns the plain-English explanation from
 * lib/expenses/categoryAdmin.ts's `describeCategoryDeletion`. The DB
 * constraint remains the real backstop; this is the readable front door.
 *
 * A RENAME EDITS `label` ONLY — never `name`. See the same module's header:
 * `name` is the stable machine key historical exports are reconciled
 * against, and rewriting it would make last quarter's CSV unmatchable.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  describeCategoryDeletion,
  swapSortOrder,
  validateExpenseCategoryRename,
  validateNewExpenseCategory,
  type ExpenseCategoryCandidate,
} from "@/lib/expenses/categoryAdmin";

export type ExpenseCategoryActionResult = { ok: true; error?: undefined } | { ok: false; error: string };

export type ExpenseCategoryQuickCreateResult =
  | { ok: true; id: string; name: string; label: string; error?: undefined }
  | { ok: false; error: string };

function revalidateCategoryViews() {
  revalidatePath("/admin/expenses/categories");
  revalidatePath("/admin/expenses");
  revalidatePath("/admin/reports/pnl");
}

async function fetchExistingCategories(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ExpenseCategoryCandidate[]> {
  const { data } = await supabase.from("expense_categories").select("id, name, label");
  return (data as ExpenseCategoryCandidate[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// Create — both the expense categories admin page's own form and the
// expense form's inline "+ Create new category" quick-create (founder
// feedback 2026-08-07 — see lib/admin/creatableSelect.ts's header) call
// this. Mirrors app/admin/companies/types/actions.ts's
// createCompanyType/createCompanyTypeInline split.
// ---------------------------------------------------------------------------

async function createExpenseCategoryCore(
  label: string,
  description: string | null,
): Promise<ExpenseCategoryQuickCreateResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create a category." };

  const existing = await fetchExistingCategories(supabase);
  const validated = validateNewExpenseCategory(label, existing);
  if (!validated.ok) return validated;

  // New categories sort after every existing one; a founder reorders with
  // the up/down controls afterwards (same "keep it simple" convention as
  // article categories).
  const { data: maxRow } = await supabase
    .from("expense_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("expense_categories")
    .insert({
      name: validated.name,
      label: validated.label,
      description: description || null,
      sort_order: nextSortOrder,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: `Could not create the category: ${error?.message ?? "unknown error"}` };
  }

  revalidateCategoryViews();
  return { ok: true, id: data.id as string, name: validated.name, label: validated.label };
}

/** Full create form on /admin/expenses/categories (label + optional description). */
export async function createExpenseCategory(
  _prevState: ExpenseCategoryActionResult,
  formData: FormData,
): Promise<ExpenseCategoryActionResult> {
  const label = String(formData.get("label") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const result = await createExpenseCategoryCore(label, description || null);
  if (!result.ok) return result;
  return { ok: true };
}

/**
 * Inline quick-create from the expense form (mirrors
 * app/admin/companies/types/actions.ts's createCompanyTypeInline) — a
 * founder can add an expense category without leaving the expense they're
 * recording. Returns the new row's id/name/label so the form can select
 * it immediately.
 */
export async function createExpenseCategoryInline(label: string): Promise<ExpenseCategoryQuickCreateResult> {
  return createExpenseCategoryCore(label, null);
}

export async function renameExpenseCategory(
  id: string,
  _prevState: ExpenseCategoryActionResult,
  formData: FormData,
): Promise<ExpenseCategoryActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to rename a category." };

  const label = String(formData.get("label") ?? "");
  const description = String(formData.get("description") ?? "").trim();

  const existing = await fetchExistingCategories(supabase);
  const validated = validateExpenseCategoryRename(label, existing, id);
  if (!validated.ok) return validated;

  // `name` is deliberately absent from this update — see the module header.
  const { error } = await supabase
    .from("expense_categories")
    .update({ label: validated.label, description: description || null })
    .eq("id", id);

  if (error) return { ok: false, error: `Could not save the category: ${error.message}` };

  revalidateCategoryViews();
  return { ok: true };
}

/**
 * Deletes a category — but only when nothing references it. The usage count
 * is re-read here rather than trusted from the client: the page's count
 * could be seconds stale, and this is the guard that decides whether a row
 * in the financial record can disappear.
 */
export async function deleteExpenseCategory(id: string): Promise<ExpenseCategoryActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to delete a category." };

  const { data: categoryRow, error: categoryError } = await supabase
    .from("expense_categories")
    .select("label")
    .eq("id", id)
    .maybeSingle<{ label: string }>();
  if (categoryError) return { ok: false, error: `Could not load the category: ${categoryError.message}` };
  if (!categoryRow) return { ok: false, error: "That category was not found (it may already be deleted)." };

  const { count, error: countError } = await supabase
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("expense_category_id", id);
  if (countError) return { ok: false, error: `Could not check whether the category is in use: ${countError.message}` };

  const verdict = describeCategoryDeletion(categoryRow.label, count ?? 0);
  if (!verdict.allowed) return { ok: false, error: verdict.message };

  const { error } = await supabase.from("expense_categories").delete().eq("id", id);
  if (error) return { ok: false, error: `Could not delete the category: ${error.message}` };

  revalidateCategoryViews();
  return { ok: true };
}

export async function reorderExpenseCategory(
  id: string,
  direction: "up" | "down",
): Promise<ExpenseCategoryActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to reorder categories." };

  const { data, error: loadError } = await supabase
    .from("expense_categories")
    .select("id, sort_order")
    .order("sort_order", { ascending: true });
  if (loadError) return { ok: false, error: `Could not load categories: ${loadError.message}` };

  const rows = (data as { id: string; sort_order: number }[] | null) ?? [];
  const swap = swapSortOrder(rows, id, direction);
  if (!swap) return { ok: true }; // already at that end — nothing to do, not an error

  for (const row of swap) {
    const { error } = await supabase
      .from("expense_categories")
      .update({ sort_order: row.sort_order })
      .eq("id", row.id);
    if (error) return { ok: false, error: `Could not reorder categories: ${error.message}` };
  }

  revalidateCategoryViews();
  return { ok: true };
}

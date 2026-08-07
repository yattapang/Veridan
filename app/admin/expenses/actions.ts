"use server";

/**
 * Operating-expense CRUD. Rows are immediate (no draft state) and freely
 * editable/deletable — an expense has no workflow of its own, unlike an
 * order's actual costs which lock once the order closes.
 *
 * Every exported symbol is an async function (the "use server" contract), and
 * every one re-checks `getCurrentUser` rather than trusting the caller —
 * these mutate financial statements.
 *
 * Validation lives in lib/expenses/expense.ts's `parseExpenseInput` so the
 * create and edit paths cannot drift apart, and so the rules are unit-tested
 * rather than only exercised through a form.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { parseExpenseInput, type ExpenseInputRaw } from "@/lib/expenses/expense";
import { jamaicaToday } from "@/lib/reports/period";

export type ExpenseActionResult = { ok: true; error?: undefined } | { ok: false; error: string };

/**
 * An expense changes the income statement, the cash-flow statement and the
 * transaction ledger, so all three are revalidated alongside the list.
 */
function revalidateExpenseViews() {
  revalidatePath("/admin/expenses");
  revalidatePath("/admin/reports/pnl");
  revalidatePath("/admin/reports/cashflow");
  revalidatePath("/admin/reports/transactions");
}

function readExpenseForm(formData: FormData): ExpenseInputRaw {
  const get = (key: string) => String(formData.get(key) ?? "");
  return {
    expenseCategoryId: get("expense_category_id"),
    description: get("description"),
    vendor: get("vendor"),
    amountJmd: get("amount_jmd"),
    amountUsd: get("amount_usd"),
    incurredDate: get("incurred_date"),
    paidDate: get("paid_date"),
    paymentMethod: get("payment_method"),
    reference: get("reference"),
    notes: get("notes"),
  };
}

export async function createExpense(
  _prevState: ExpenseActionResult,
  formData: FormData,
): Promise<ExpenseActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to record an expense." };

  const parsed = parseExpenseInput(readExpenseForm(formData), jamaicaToday());
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("expenses").insert({ ...parsed.fields, recorded_by: user.id });
  if (error) return { ok: false, error: `Could not save the expense: ${error.message}` };

  revalidateExpenseViews();
  return { ok: true };
}

export async function updateExpense(
  expenseId: string,
  _prevState: ExpenseActionResult,
  formData: FormData,
): Promise<ExpenseActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to edit an expense." };

  const parsed = parseExpenseInput(readExpenseForm(formData), jamaicaToday());
  if (!parsed.ok) return parsed;

  const { data, error } = await supabase
    .from("expenses")
    .update(parsed.fields)
    .eq("id", expenseId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: `Could not update the expense: ${error.message}` };
  if (!data) return { ok: false, error: "That expense was not found (it may have been deleted)." };

  revalidateExpenseViews();
  return { ok: true };
}

export async function deleteExpense(expenseId: string): Promise<ExpenseActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to delete an expense." };

  const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
  if (error) return { ok: false, error: `Could not delete the expense: ${error.message}` };

  revalidateExpenseViews();
  return { ok: true };
}

/**
 * One-click "mark as paid today" / "mark as unpaid". A dedicated action
 * rather than making the founder open the edit form, because the paid_date
 * is the single field that decides whether an expense appears in every
 * cash-basis figure — it is the one people update most often.
 */
export async function setExpensePaidDate(
  expenseId: string,
  paidDate: string | null,
): Promise<ExpenseActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to change an expense's payment date." };

  if (paidDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
    return { ok: false, error: "Date paid must be a valid date." };
  }

  const { data, error } = await supabase
    .from("expenses")
    .update({ paid_date: paidDate })
    .eq("id", expenseId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: `Could not update the expense: ${error.message}` };
  if (!data) return { ok: false, error: "That expense was not found (it may have been deleted)." };

  revalidateExpenseViews();
  return { ok: true };
}

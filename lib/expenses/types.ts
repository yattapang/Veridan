/**
 * Row types for the operating-expenses tables. See
 * supabase/migrations/20260807000002_expenses.sql.
 *
 * WHY THESE LIVE HERE AND NOT IN lib/supabase/types.ts: that file is the
 * shared hand-written schema map for tables the whole admin touches. These
 * three types are consumed only by lib/expenses/, lib/reports/ and
 * app/admin/expenses/, so keeping them beside the logic that uses them keeps
 * the expenses module self-contained. The report loaders map every row into
 * the pure-function input shapes in lib/reports/ before any arithmetic
 * happens, so nothing outside this folder ever needs to import them.
 */

/**
 * `expense_categories` — the admin-managed operating-expense taxonomy.
 * `name` is a STABLE snake_case machine key (never rewritten by a rename, so
 * historical exports stay reconcilable); `label` is the editable display
 * string. Unlike `ArticleCategoryRow` this IS a referential constraint:
 * `expenses.expense_category_id` is a real FK with ON DELETE RESTRICT.
 */
export interface ExpenseCategoryRow {
  id: string;
  name: string;
  label: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * A category plus how many expenses reference it. Unlike an article
 * category's advisory count, this one is load-bearing: the FK is ON DELETE
 * RESTRICT, so a category with `usageCount > 0` genuinely cannot be deleted
 * and the UI blocks the attempt up front rather than surfacing a raw
 * Postgres foreign-key violation.
 */
export interface ExpenseCategoryWithUsageCount extends ExpenseCategoryRow {
  usageCount: number;
}

/**
 * `expenses` — operating expenditure not attributable to any order (there is
 * deliberately no `order_id`). `incurred_date` is the accrual-basis date;
 * `paid_date` is the cash-basis date, and NULL means unpaid/accrued.
 */
export interface ExpenseRow {
  id: string;
  expense_category_id: string;
  description: string;
  vendor: string | null;
  amount_jmd: number | null;
  amount_usd: number | null;
  incurred_date: string;
  paid_date: string | null;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

/** An expense joined with its category, for the admin list and the reports. */
export interface ExpenseWithCategory extends ExpenseRow {
  expense_categories: { id: string; name: string; label: string } | null;
}

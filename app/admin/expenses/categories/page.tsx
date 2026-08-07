import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import {
  computeExpenseCategoryUsageCounts,
  expenseCategoryUsageCountFor,
} from "@/lib/expenses/categoryAdmin";
import type { ExpenseCategoryRow, ExpenseCategoryWithUsageCount } from "@/lib/expenses/types";
import { ExpenseCategoryForm } from "./ExpenseCategoryForm";
import { ExpenseCategoryListItem } from "./ExpenseCategoryListItem";

export const metadata = {
  title: "Expense Categories",
};

/**
 * The managed operating-expense taxonomy — effectively Veridan's chart of
 * operating accounts. The order set here is the order the income statement's
 * Operating Expenses section reads in.
 *
 * Unlike article categories, this list CONSTRAINS its data: every expense
 * carries a real FK to it, so a category in use cannot be deleted. The usage
 * count on each row is therefore load-bearing, not advisory, and the page
 * says so up front.
 */
export default async function ExpenseCategoriesPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Expense Categories</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const [categoriesResult, expensesResult] = await Promise.all([
    supabase.from("expense_categories").select("*").order("sort_order", { ascending: true }),
    supabase.from("expenses").select("expense_category_id"),
  ]);

  if (categoriesResult.error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Expense Categories</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The expense_categories table couldn't be loaded (${categoriesResult.error.message}). Check that the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const categoryRows = (categoriesResult.data as ExpenseCategoryRow[] | null) ?? [];
  const usageCounts = computeExpenseCategoryUsageCounts(
    (expensesResult.data as { expense_category_id: string }[] | null) ?? [],
  );
  const categories: ExpenseCategoryWithUsageCount[] = categoryRows.map((c) => ({
    ...c,
    usageCount: expenseCategoryUsageCountFor(c.id, usageCounts),
  }));

  return (
    <div className="max-w-3xl">
      <Link href="/admin/expenses" className="text-xs text-veridan-warm-gray hover:text-veridan-ink">
        ← All expenses
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-veridan-ink">Expense Categories</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        The categories the income statement groups Operating Expenses by; this order is the order they appear in.
        <strong> A category that is in use cannot be deleted</strong> — every expense holds a real reference to
        its category, and removing one would change financial statements that have already been reported.
        Renaming is always safe: it changes the display name only, and each category keeps a fixed internal key
        so past CSV and Excel exports stay reconcilable.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Create a category
        </h2>
        <ExpenseCategoryForm />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          All categories
        </h2>
        {categories.length === 0 ? (
          <InstructiveMessage
            title="No categories yet"
            body="Create your first category above, e.g. &ldquo;Rent &amp; Utilities&rdquo;."
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {categories.map((c, index) => (
              <ExpenseCategoryListItem
                key={c.id}
                category={c}
                isFirst={index === 0}
                isLast={index === categories.length - 1}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

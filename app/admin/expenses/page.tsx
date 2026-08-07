import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { formatJmd, formatUsd } from "@/lib/quotes/format";
import { filterExpenses, parseExpensePaymentFilter } from "@/lib/expenses/expense";
import type { ExpenseCategoryRow, ExpenseWithCategory } from "@/lib/expenses/types";
import { jamaicaToday, yearToDateRange } from "@/lib/reports/period";
import { ExpenseFilters } from "./ExpenseFilters";
import { ExpenseForm } from "./ExpenseForm";
import { ExpenseListItem } from "./ExpenseListItem";

export const metadata = {
  title: "Operating Expenses",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Operating expenses — real money spent running the business, not
 * attributable to any single order. This is the missing bottom half of a
 * real income statement: without it, "profit" was only ever gross profit.
 *
 * Totals shown here are deliberately SEPARATE per currency rather than
 * combined into one JMD figure. This page has no business reason to reach
 * for an FX rate, and showing "J$X (plus US$Y unconverted)" is more honest
 * at data-entry time than a converted total whose rate is not stated. The
 * income statement is where conversion happens, and it labels it.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const defaultRange = yearToDateRange();
  const startIso = firstParam(query.start).trim() || defaultRange.startIso;
  const endIso = firstParam(query.end).trim() || defaultRange.endIso;
  const categoryId = firstParam(query.category).trim();
  const payment = parseExpensePaymentFilter(firstParam(query.payment));
  const today = jamaicaToday();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Operating expenses</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const [categoriesResult, expensesResult] = await Promise.all([
    supabase.from("expense_categories").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("expenses")
      .select("*, expense_categories(id, name, label)")
      .order("incurred_date", { ascending: false }),
  ]);

  if (categoriesResult.error || expensesResult.error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Operating expenses</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The expenses tables couldn't be loaded (${
            categoriesResult.error?.message ?? expensesResult.error?.message
          }). Check that the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const categories = (categoriesResult.data as ExpenseCategoryRow[] | null) ?? [];
  const allExpenses = (expensesResult.data as unknown as ExpenseWithCategory[] | null) ?? [];
  const expenses = filterExpenses(allExpenses, { startIso, endIso, categoryId: categoryId || null, payment });

  // A single row may carry BOTH an amount_jmd and an amount_usd (one bill,
  // recorded in two currencies), in which case it appears in full in each
  // tally below. The two are therefore NOT summable, and the tile labels say
  // so — see the count of dual-currency rows rendered beneath them. The
  // reports handle this correctly already (a JMD-present row is never
  // re-derived from its USD sibling); this is a display-only clarification.
  const totalJmd = expenses.reduce((s, e) => s + (e.amount_jmd ?? 0), 0);
  const totalUsd = expenses.reduce((s, e) => s + (e.amount_usd ?? 0), 0);
  const bothCurrenciesCount = expenses.filter((e) => e.amount_jmd != null && e.amount_usd != null).length;
  const unpaidCount = expenses.filter((e) => e.paid_date == null).length;

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-veridan-ink">Operating expenses</h1>
          <p className="mt-2 max-w-3xl text-sm text-veridan-warm-gray">
            Real money spent running the business — rent, salaries, professional fees, bank charges — as opposed
            to the cost of fulfilling a specific order, which is recorded against that order as an actual cost.
            These feed the <strong>Operating Expenses</strong> line of the income statement and the outflows on
            the cash-flow statement. They are deliberately <strong>not</strong> attributed to any order: rent is
            not a cost of one shipment, so per-order figures stay gross margin only.
          </p>
        </div>
        <Link
          href="/admin/expenses/categories"
          className="shrink-0 rounded-md border border-veridan-warm-gray-light bg-white px-3 py-1.5 text-xs font-medium text-veridan-ink transition-opacity duration-150 hover:opacity-80"
        >
          Manage categories
        </Link>
      </div>

      <div className="mt-6">
        <ExpenseFilters
          startIso={startIso}
          endIso={endIso}
          categoryId={categoryId}
          payment={payment}
          categories={categories}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
            JMD amounts entered
          </p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatJmd(totalJmd, 2)}</p>
          <p className="text-xs text-veridan-warm-gray">Sum of the JMD field. Not a period total.</p>
        </div>
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
            USD amounts entered
          </p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatUsd(totalUsd)}</p>
          <p className="text-xs text-veridan-warm-gray">Sum of the USD field. Not a period total.</p>
        </div>
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Unpaid</p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{unpaidCount}</p>
          <p className="text-xs text-veridan-warm-gray">
            {unpaidCount === 0
              ? "Everything in this range is marked paid."
              : "Counted on the accrual basis; excluded from cash-basis figures."}
          </p>
        </div>
      </div>

      <p className="mt-2 max-w-3xl text-xs text-veridan-warm-gray">
        The two currency figures are <strong>two separate tallies of two separate fields</strong>, not two halves
        of one total — <strong>do not add them</strong>.{" "}
        {bothCurrenciesCount > 0
          ? `${bothCurrenciesCount} row${bothCurrenciesCount === 1 ? " in" : "s in"} this range carr${
              bothCurrenciesCount === 1 ? "ies" : "y"
            } both a JMD and a USD amount and so appear${
              bothCurrenciesCount === 1 ? "s" : ""
            } in full in each. `
          : ""}
        The single, correctly converted period figure lives on the income statement, which states the rate it used.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Record an expense
        </h2>
        {categories.length === 0 ? (
          <InstructiveMessage
            title="No expense categories yet"
            body="Every expense needs a category. Create your first one under “Manage categories”, then come back here."
          />
        ) : (
          <ExpenseForm categories={categories} today={today} />
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Expenses ({expenses.length})
        </h2>
        {expenses.length === 0 ? (
          <InstructiveMessage
            title="No expenses in this range"
            body="Expenses incurred within the selected dates will appear here. Widen the date range or clear the filters to see more."
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white">
            {expenses.map((e) => (
              <ExpenseListItem key={e.id} expense={e} categories={categories} today={today} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

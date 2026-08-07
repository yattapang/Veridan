"use client";

import { useState, useTransition } from "react";
import { formatJmd, formatUsd } from "@/lib/quotes/format";
import type { ExpenseCategoryRow, ExpenseWithCategory } from "@/lib/expenses/types";
import { deleteExpense, setExpensePaidDate } from "./actions";
import { ExpenseForm } from "./ExpenseForm";

/**
 * One expense row. Shows both dates side by side, because which of them is
 * filled in is what decides whether this expense appears in cash-basis
 * figures — an "Unpaid" badge makes that visible at a glance rather than
 * requiring the founder to read a date column.
 */
export function ExpenseListItem({
  expense,
  categories,
  today,
}: {
  expense: ExpenseWithCategory;
  categories: ExpenseCategoryRow[];
  today: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isPaid = expense.paid_date != null;

  function handleDelete() {
    setError(null);
    const confirmed = window.confirm(
      `Delete "${expense.description}"? This removes it from the income statement, the cash-flow statement and the transaction ledger.`,
    );
    if (!confirmed) return;
    startTransition(async () => {
      const result = await deleteExpense(expense.id);
      if (!result.ok) setError(result.error);
    });
  }

  function handleTogglePaid() {
    setError(null);
    startTransition(async () => {
      const result = await setExpensePaidDate(expense.id, isPaid ? null : today);
      if (!result.ok) setError(result.error);
    });
  }

  if (editing) {
    return (
      <li className="border-b border-veridan-warm-gray-light px-4 py-4 last:border-b-0">
        <ExpenseForm
          categories={categories}
          expense={expense}
          today={today}
          onSaved={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-veridan-warm-gray-light px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-veridan-ink">{expense.description}</p>
          <span className="rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray">
            {expense.expense_categories?.label ?? "Uncategorized"}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              isPaid ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {isPaid ? "Paid" : "Unpaid"}
          </span>
        </div>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          Incurred {expense.incurred_date}
          {isPaid ? ` · Paid ${expense.paid_date}` : " · not yet paid (excluded from cash-basis figures)"}
          {expense.vendor ? ` · ${expense.vendor}` : ""}
          {expense.reference ? ` · ref ${expense.reference}` : ""}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          {expense.amount_jmd != null && (
            <p className="text-sm font-medium text-veridan-ink">{formatJmd(expense.amount_jmd, 2)}</p>
          )}
          {expense.amount_usd != null && (
            <p className="text-xs text-veridan-warm-gray">{formatUsd(expense.amount_usd)}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleTogglePaid}
            disabled={pending}
            className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft disabled:opacity-50"
          >
            {isPaid ? "Mark unpaid" : "Mark paid today"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink disabled:opacity-50"
          >
            {pending ? "Working…" : "Delete"}
          </button>
        </div>
      </div>
    </li>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ExpenseCategoryRow, ExpenseRow } from "@/lib/expenses/types";
import { createExpense, updateExpense, type ExpenseActionResult } from "./actions";

const initialResult: ExpenseActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

/**
 * Shared create/edit form for an operating expense — `expense` present means
 * edit mode, absent means the "record an expense" form (same create-vs-edit
 * convention as app/admin/articles/categories/CategoryForm.tsx).
 *
 * The two date fields are the load-bearing ones and are labelled to say so:
 * "Date incurred" drives the accrual-basis statements, "Date paid" drives
 * every cash-basis figure and is left blank while the bill is outstanding.
 */
export function ExpenseForm({
  categories,
  expense,
  today,
  onSaved,
}: {
  categories: ExpenseCategoryRow[];
  expense?: ExpenseRow;
  today: string;
  onSaved?: () => void;
}) {
  const action = expense ? updateExpense.bind(null, expense.id) : createExpense;
  const [state, formAction, pending] = useActionState<ExpenseActionResult, FormData>(action, initialResult);
  const idSuffix = expense?.id ?? "new";
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  // On a successful save: clear the create form so the next expense can be
  // typed straight away, or close the inline editor. Watching the
  // pending→settled edge (rather than `state` alone) is what distinguishes a
  // completed submit from the initial render, whose state is also `ok`.
  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      if (expense) onSaved?.();
      else formRef.current?.reset();
    }
    wasPending.current = pending;
  }, [pending, state.ok, expense, onSaved]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`expense-category-${idSuffix}`}>
          Category
        </label>
        <select
          id={`expense-category-${idSuffix}`}
          name="expense_category_id"
          required
          defaultValue={expense?.expense_category_id ?? ""}
          className={`${inputClass} mt-1`}
        >
          <option value="" disabled>
            Choose…
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-4">
        <label className={labelClass} htmlFor={`expense-description-${idSuffix}`}>
          Description
        </label>
        <input
          id={`expense-description-${idSuffix}`}
          name="description"
          type="text"
          required
          placeholder="Office rent — August"
          defaultValue={expense?.description ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`expense-vendor-${idSuffix}`}>
          Vendor
        </label>
        <input
          id={`expense-vendor-${idSuffix}`}
          name="vendor"
          type="text"
          defaultValue={expense?.vendor ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`expense-jmd-${idSuffix}`}>
          Amount JMD
        </label>
        <input
          id={`expense-jmd-${idSuffix}`}
          name="amount_jmd"
          type="number"
          step="0.01"
          min="0"
          defaultValue={expense?.amount_jmd ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`expense-usd-${idSuffix}`}>
          Amount USD
        </label>
        <input
          id={`expense-usd-${idSuffix}`}
          name="amount_usd"
          type="number"
          step="0.01"
          min="0"
          defaultValue={expense?.amount_usd ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`expense-incurred-${idSuffix}`}>
          Date incurred
        </label>
        <input
          id={`expense-incurred-${idSuffix}`}
          name="incurred_date"
          type="date"
          defaultValue={expense?.incurred_date ?? today}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`expense-paid-${idSuffix}`}>
          Date paid
        </label>
        <input
          id={`expense-paid-${idSuffix}`}
          name="paid_date"
          type="date"
          defaultValue={expense?.paid_date ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`expense-method-${idSuffix}`}>
          Payment method
        </label>
        <input
          id={`expense-method-${idSuffix}`}
          name="payment_method"
          type="text"
          defaultValue={expense?.payment_method ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`expense-reference-${idSuffix}`}>
          Reference
        </label>
        <input
          id={`expense-reference-${idSuffix}`}
          name="reference"
          type="text"
          defaultValue={expense?.reference ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-6">
        <label className={labelClass} htmlFor={`expense-notes-${idSuffix}`}>
          Notes
        </label>
        <input
          id={`expense-notes-${idSuffix}`}
          name="notes"
          type="text"
          defaultValue={expense?.notes ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <p className="sm:col-span-6 text-xs text-veridan-warm-gray">
        Enter an amount in JMD, USD, or both. Leave <strong>Date paid</strong> blank while the bill is
        outstanding — an unpaid expense still counts on the accrual-basis income statement, and is correctly
        excluded from every cash-basis figure and from the cash-flow statement.
      </p>

      <div className="sm:col-span-6 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving…" : expense ? "Save changes" : "Record expense"}
        </button>
        {expense && onSaved && (
          <button
            type="button"
            onClick={onSaved}
            className="text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
          >
            Cancel
          </button>
        )}
        {state.ok === false && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

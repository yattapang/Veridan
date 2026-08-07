"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ExpenseCategoryRow } from "@/lib/expenses/types";
import {
  createExpenseCategory,
  renameExpenseCategory,
  type ExpenseCategoryActionResult,
} from "./actions";

const initialResult: ExpenseCategoryActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Create/rename form for an expense category. `category` present means
 * rename mode.
 *
 * There is no field for the internal key: it is derived from the name on
 * CREATE and then never changes, because exports are reconciled against it
 * (see lib/expenses/categoryAdmin.ts). In rename mode the existing key is
 * shown read-only so a founder can see that renaming is display-only and
 * safe.
 */
export function ExpenseCategoryForm({
  category,
  onSaved,
}: {
  category?: ExpenseCategoryRow;
  onSaved?: () => void;
}) {
  const action = category ? renameExpenseCategory.bind(null, category.id) : createExpenseCategory;
  const [state, formAction, pending] = useActionState<ExpenseCategoryActionResult, FormData>(
    action,
    initialResult,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const idSuffix = category?.id ?? "new";

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      if (!category) formRef.current?.reset();
      onSaved?.();
    }
    wasPending.current = pending;
  }, [pending, state.ok, category, onSaved]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`expense-category-label-${idSuffix}`}>
          Name
        </label>
        <input
          id={`expense-category-label-${idSuffix}`}
          type="text"
          name="label"
          required
          placeholder="Rent &amp; Utilities"
          defaultValue={category?.label}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`expense-category-description-${idSuffix}`}>
          Description
        </label>
        <textarea
          id={`expense-category-description-${idSuffix}`}
          name="description"
          rows={2}
          defaultValue={category?.description ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      {category && (
        <p className="sm:col-span-2 text-xs text-veridan-warm-gray">
          Internal key <code className="rounded bg-veridan-warm-gray-pale px-1 py-0.5">{category.name}</code> —
          fixed for the life of the category so past exports stay reconcilable. Renaming changes only what is
          displayed; every expense already in this category keeps its figures untouched.
        </p>
      )}

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : category ? "Save changes" : "Add category"}
        </button>
        {state.ok === false && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

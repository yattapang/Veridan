"use client";

import { useState, useTransition } from "react";
import { describeCategoryDeletion } from "@/lib/expenses/categoryAdmin";
import type { ExpenseCategoryWithUsageCount } from "@/lib/expenses/types";
import { deleteExpenseCategory, reorderExpenseCategory } from "./actions";
import { ExpenseCategoryForm } from "./ExpenseCategoryForm";

/**
 * One managed expense category.
 *
 * THE DELETE BUTTON IS DISABLED WHEN THE CATEGORY IS IN USE, and says why
 * in its tooltip and in an inline note — rather than being clickable and
 * failing. The FK is ON DELETE RESTRICT, so a delete of an in-use category
 * genuinely cannot succeed; offering the button anyway would be inviting a
 * founder to hit an error. `describeCategoryDeletion` is the same pure
 * function the server action re-checks with, so the message a founder reads
 * here is exactly the rule the server enforces.
 */
export function ExpenseCategoryListItem({
  category,
  isFirst,
  isLast,
}: {
  category: ExpenseCategoryWithUsageCount;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reordering, startReorderTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const verdict = describeCategoryDeletion(category.label, category.usageCount);

  function handleDelete() {
    setError(null);
    if (!verdict.allowed) {
      setError(verdict.message);
      return;
    }
    if (!window.confirm(verdict.message)) return;
    startTransition(async () => {
      const result = await deleteExpenseCategory(category.id);
      if (!result.ok) setError(result.error);
    });
  }

  function handleReorder(direction: "up" | "down") {
    setError(null);
    startReorderTransition(async () => {
      const result = await reorderExpenseCategory(category.id, direction);
      if (!result.ok) setError(result.error);
    });
  }

  if (editing) {
    return (
      <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
        <ExpenseCategoryForm category={category} onSaved={() => setEditing(false)} />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2 text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
        >
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-veridan-warm-gray-light py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-veridan-ink">{category.label}</p>
          <span className="rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray">
            {category.usageCount} expense{category.usageCount === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          <code className="rounded bg-veridan-warm-gray-pale px-1 py-0.5">{category.name}</code>
          {category.description ? ` · ${category.description}` : ""}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleReorder("up")}
            disabled={isFirst || reordering}
            aria-label={`Move ${category.label} up`}
            className="rounded border border-veridan-warm-gray-light px-1.5 py-0.5 text-xs text-veridan-warm-gray hover:text-veridan-ink disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => handleReorder("down")}
            disabled={isLast || reordering}
            aria-label={`Move ${category.label} down`}
            className="rounded border border-veridan-warm-gray-light px-1.5 py-0.5 text-xs text-veridan-warm-gray hover:text-veridan-ink disabled:opacity-30"
          >
            ↓
          </button>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
        >
          Rename / edit
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending || !verdict.allowed}
          title={verdict.allowed ? undefined : verdict.message}
          className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
      </div>
    </li>
  );
}

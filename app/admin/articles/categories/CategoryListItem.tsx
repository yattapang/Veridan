"use client";

import { useState, useTransition } from "react";
import type { ArticleCategoryWithUsageCount } from "@/lib/supabase/types";
import { deleteArticleCategory, reorderArticleCategory } from "./actions";
import { CategoryForm } from "./CategoryForm";

export function CategoryListItem({
  category,
  isFirst,
  isLast,
}: {
  category: ArticleCategoryWithUsageCount;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reordering, startReorderTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    // Confirm dialog states the usage count and is explicit that existing
    // articles are untouched — the founder's stated requirement ("surface
    // the usage count so a founder deletes knowingly"). Deleting this row
    // never modifies or orphans any article; it only removes it from
    // future pickers (see app/admin/articles/categories/actions.ts's
    // deleteArticleCategory).
    const confirmed = window.confirm(
      category.usageCount > 0
        ? `Delete "${category.name}"? ${category.usageCount} article${
            category.usageCount === 1 ? "" : "s"
          } currently ${
            category.usageCount === 1 ? "uses" : "use"
          } this category — deleting it only removes it from future pickers. Those article${
            category.usageCount === 1 ? "" : "s"
          } will keep showing "${category.name}" exactly as-is.`
        : `Delete "${category.name}"? No articles currently use it.`
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await deleteArticleCategory(category.id);
      if (!result.ok) setError(result.error);
    });
  }

  function handleReorder(direction: "up" | "down") {
    setError(null);
    startReorderTransition(async () => {
      const result = await reorderArticleCategory(category.id, direction);
      if (!result.ok) setError(result.error);
    });
  }

  if (editing) {
    return (
      <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
        <CategoryForm category={category} onSaved={() => setEditing(false)} />
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
          <p className="text-sm font-medium text-veridan-ink">{category.name}</p>
          <span className="rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray">
            {category.usageCount} article{category.usageCount === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          /{category.slug}
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
            aria-label={`Move ${category.name} up`}
            className="rounded border border-veridan-warm-gray-light px-1.5 py-0.5 text-xs text-veridan-warm-gray hover:text-veridan-ink disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => handleReorder("down")}
            disabled={isLast || reordering}
            aria-label={`Move ${category.name} down`}
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
          disabled={pending}
          className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
      </div>
    </li>
  );
}

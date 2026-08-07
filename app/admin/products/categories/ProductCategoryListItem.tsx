"use client";

import { useState, useTransition } from "react";
import type { ProductCategoryAdminWithUsageCount } from "@/lib/supabase/types";
import { deleteProductCategory } from "./actions";
import { ProductCategoryForm } from "./ProductCategoryForm";

export function ProductCategoryListItem({
  category,
}: {
  category: ProductCategoryAdminWithUsageCount;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    // Confirm dialog states the usage count and is explicit that existing
    // products are untouched — deleting this row never modifies or orphans
    // any product; it only removes it from future pickers (see
    // app/admin/products/categories/actions.ts's deleteProductCategory).
    const confirmed = window.confirm(
      category.usageCount > 0
        ? `Delete "${category.label}"? ${category.usageCount} product${
            category.usageCount === 1 ? "" : "s"
          } currently ${
            category.usageCount === 1 ? "uses" : "use"
          } this category — deleting it only removes it from future pickers. Those product${
            category.usageCount === 1 ? "" : "s"
          } will keep their category exactly as-is.`
        : `Delete "${category.label}"? No products currently use it.`
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await deleteProductCategory(category.id);
      if (!result.ok) setError(result.error);
    });
  }

  if (editing) {
    return (
      <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
        <ProductCategoryForm category={category} onSaved={() => setEditing(false)} />
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
            {category.usageCount} product{category.usageCount === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-1 text-xs text-veridan-warm-gray">stored as &ldquo;{category.name}&rdquo;</p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
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

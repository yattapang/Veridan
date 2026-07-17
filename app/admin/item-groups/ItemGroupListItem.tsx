"use client";

import { useState, useTransition } from "react";
import type { ItemGroupWithProductCount } from "@/lib/supabase/types";
import { deleteItemGroup } from "./actions";
import { ItemGroupForm } from "./ItemGroupForm";

export function ItemGroupListItem({ itemGroup }: { itemGroup: ItemGroupWithProductCount }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const productCount = itemGroup.products?.[0]?.count ?? 0;

  function handleDelete() {
    setError(null);
    const confirmed = window.confirm(
      productCount > 0
        ? `Delete "${itemGroup.family_name}"? ${productCount} product${
            productCount === 1 ? "" : "s"
          } currently in this group will become ungrouped (their own data is untouched).`
        : `Delete "${itemGroup.family_name}"?`
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await deleteItemGroup(itemGroup.id);
      if (!result.ok) setError(result.error);
    });
  }

  if (editing) {
    return (
      <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
        <ItemGroupForm itemGroup={itemGroup} onSaved={() => setEditing(false)} />
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
          <p className="text-sm font-medium text-veridan-ink">{itemGroup.family_name}</p>
          {itemGroup.grade && (
            <span className="rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray">
              {itemGroup.grade}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          {productCount} product{productCount === 1 ? "" : "s"}
          {itemGroup.notes ? ` · ${itemGroup.notes}` : ""}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <a
          href={`/admin/products/compare/${itemGroup.id}`}
          className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
        >
          Compare offerings
        </a>
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

"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ArticleCategoryRow } from "@/lib/supabase/types";
import { createArticleCategory, renameArticleCategory, type CategoryActionResult } from "./actions";

const initialCategoryActionResult: CategoryActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Shared create/rename form for an article category — mirrors
 * app/admin/item-groups/ItemGroupForm.tsx's create-vs-edit convention.
 * `category` present means rename mode (bound to renameArticleCategory);
 * absent means the "new category" form (bound to createArticleCategory).
 * The slug is auto-derived server-side (lib/articles/categoryAdmin.ts's
 * deriveCategorySlug) — there is no slug field here to keep this simple.
 */
export function CategoryForm({
  category,
  onSaved,
}: {
  category?: ArticleCategoryRow;
  onSaved?: () => void;
}) {
  const action = category ? renameArticleCategory.bind(null, category.id) : createArticleCategory;
  const [state, formAction, pending] = useActionState<CategoryActionResult, FormData>(
    action,
    initialCategoryActionResult
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
        <label className={labelClass} htmlFor={`category-name-${idSuffix}`}>
          Name
        </label>
        <input
          id={`category-name-${idSuffix}`}
          type="text"
          name="name"
          required
          placeholder="Hardware Fundamentals"
          defaultValue={category?.name}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`category-description-${idSuffix}`}>
          Description
        </label>
        <textarea
          id={`category-description-${idSuffix}`}
          name="description"
          rows={2}
          defaultValue={category?.description ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

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

"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ProductCategoryAdminRow } from "@/lib/supabase/types";
import {
  createProductCategoryForm,
  renameProductCategory,
  type ProductCategoryActionResult,
} from "./actions";

const initialResult: ProductCategoryActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Shared create/rename form for a product category — mirrors
 * app/admin/companies/types/CompanyTypeForm.tsx / app/admin/articles/
 * categories/CategoryForm.tsx's create-vs-edit convention. `category`
 * present means rename mode (bound to renameProductCategory); absent means
 * the "new category" form (bound to createProductCategoryForm). The stored
 * value is auto-derived server-side from the label
 * (lib/taxonomies/taxonomyAdmin.ts's deriveTaxonomyName).
 */
export function ProductCategoryForm({
  category,
  onSaved,
}: {
  category?: ProductCategoryAdminRow;
  onSaved?: () => void;
}) {
  const action = category ? renameProductCategory.bind(null, category.id) : createProductCategoryForm;
  const [state, formAction, pending] = useActionState<ProductCategoryActionResult, FormData>(
    action,
    initialResult
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
        <label className={labelClass} htmlFor={`product-category-label-${idSuffix}`}>
          Label
        </label>
        <input
          id={`product-category-label-${idSuffix}`}
          type="text"
          name="label"
          required
          placeholder="Door bottoms"
          defaultValue={category?.label}
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

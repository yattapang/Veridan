"use client";

import { useActionState, useEffect, useRef } from "react";
import type { CompanyTypeRow } from "@/lib/supabase/types";
import { createCompanyTypeForm, renameCompanyType, type CompanyTypeActionResult } from "./actions";

const initialResult: CompanyTypeActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Shared create/rename form for a company type — mirrors
 * app/admin/articles/categories/CategoryForm.tsx's create-vs-edit
 * convention. `companyType` present means rename mode (bound to
 * renameCompanyType); absent means the "new type" form (bound to
 * createCompanyTypeForm). The stored value is auto-derived server-side
 * from the label (lib/taxonomies/taxonomyAdmin.ts's deriveTaxonomyName) —
 * there is no separate "stored value" field here to keep this simple.
 */
export function CompanyTypeForm({
  companyType,
  onSaved,
}: {
  companyType?: CompanyTypeRow;
  onSaved?: () => void;
}) {
  const action = companyType ? renameCompanyType.bind(null, companyType.id) : createCompanyTypeForm;
  const [state, formAction, pending] = useActionState<CompanyTypeActionResult, FormData>(
    action,
    initialResult
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const idSuffix = companyType?.id ?? "new";

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      if (!companyType) formRef.current?.reset();
      onSaved?.();
    }
    wasPending.current = pending;
  }, [pending, state.ok, companyType, onSaved]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`company-type-label-${idSuffix}`}>
          Label
        </label>
        <input
          id={`company-type-label-${idSuffix}`}
          type="text"
          name="label"
          required
          placeholder="Consultant"
          defaultValue={companyType?.label}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : companyType ? "Save changes" : "Add type"}
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

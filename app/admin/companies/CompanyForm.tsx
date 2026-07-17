"use client";

import { useActionState, useEffect, useRef } from "react";
import { COMPANY_TYPES, type CompanyRow } from "@/lib/supabase/types";
import {
  createCompany,
  updateCompany,
  type CompanyFormResult,
} from "./actions";

const initialCompanyFormResult: CompanyFormResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

const TYPE_LABELS: Record<string, string> = {
  architect: "Architect",
  contractor: "Contractor",
  owner: "Owner",
  fm: "Facilities Management",
  supplier_contact: "Supplier contact",
};

/**
 * Shared create/edit form for a company (Task 12). `company` present
 * means edit mode (bound to updateCompany, stays on the detail page on
 * save); absent means the "new company" form on the list page (bound to
 * createCompany, which redirects to the new detail page on success).
 */
export function CompanyForm({
  company,
  onSaved,
}: {
  company?: CompanyRow;
  onSaved?: () => void;
}) {
  const action = company ? updateCompany.bind(null, company.id) : createCompany;
  const [state, formAction, pending] = useActionState<CompanyFormResult, FormData>(
    action,
    initialCompanyFormResult
  );
  const idSuffix = company?.id ?? "new";
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok && company) {
      onSaved?.();
    }
    wasPending.current = pending;
  }, [pending, state.ok, company, onSaved]);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`name-${idSuffix}`}>
          Name
        </label>
        <input
          id={`name-${idSuffix}`}
          type="text"
          name="name"
          required
          defaultValue={company?.name}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`type-${idSuffix}`}>
          Type
        </label>
        <select
          id={`type-${idSuffix}`}
          name="type"
          defaultValue={company?.type ?? "architect"}
          className={`${inputClass} mt-1`}
        >
          {COMPANY_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor={`status-${idSuffix}`}>
          Status
        </label>
        <select
          id={`status-${idSuffix}`}
          name="status"
          defaultValue={company?.status ?? "new"}
          className={`${inputClass} mt-1`}
        >
          <option value="new">New</option>
          <option value="established">Established</option>
        </select>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          Manual only — drives the 60% vs. reduced deposit default (§7).
          Never flips automatically.
        </p>
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`notes-${idSuffix}`}>
          Notes
        </label>
        <textarea
          id={`notes-${idSuffix}`}
          name="notes"
          rows={2}
          defaultValue={company?.notes ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : company ? "Save changes" : "Add company"}
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

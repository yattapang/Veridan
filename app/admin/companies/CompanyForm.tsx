"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { CompanyRow } from "@/lib/supabase/types";
import { buildTaxonomyOptions } from "@/lib/taxonomies/taxonomyAdmin";
import type { ManagedCompanyType } from "@/lib/companies/typesLoader";
import {
  createCompany,
  updateCompany,
  type CompanyFormResult,
} from "./actions";
import { createCompanyTypeInline } from "./types/actions";

const initialCompanyFormResult: CompanyFormResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Shared create/edit form for a company (Task 12). `company` present
 * means edit mode (bound to updateCompany, stays on the detail page on
 * save); absent means the "new company" form on the list page (bound to
 * createCompany, which redirects to the new detail page on success).
 *
 * `companyTypes` is the DB-first managed list (lib/companies/typesLoader.ts,
 * falling back to the original 5 hardcoded values when the table is
 * unreachable/empty), read by the server component and passed down here.
 * Founder feedback 2026-08-07 ("the company type does not allow the admin
 * to edit, create, or delete company types") — the Type picker now offers
 * an inline "+ New type" quick-create, mirroring
 * app/admin/products/ProductForm.tsx's item-group pattern (Task 31). If
 * `company.type` holds a legacy value not in the managed list,
 * buildTaxonomyOptions appends it as a labelled "custom" option so saving
 * never silently changes it.
 */
export function CompanyForm({
  company,
  companyTypes,
  onSaved,
}: {
  company?: CompanyRow;
  companyTypes: ManagedCompanyType[];
  onSaved?: () => void;
}) {
  const action = company ? updateCompany.bind(null, company.id) : createCompany;
  const [state, formAction, pending] = useActionState<CompanyFormResult, FormData>(
    action,
    initialCompanyFormResult
  );
  const idSuffix = company?.id ?? "new";
  const wasPending = useRef(false);

  const [locallyCreatedTypes, setLocallyCreatedTypes] = useState<ManagedCompanyType[]>([]);
  const [selectedType, setSelectedType] = useState(company?.type ?? companyTypes[0]?.name ?? "");
  const [creatingType, setCreatingType] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [typeError, setTypeError] = useState<string | null>(null);
  const [typePending, startTypeTransition] = useTransition();

  const knownTypeIds = new Set(companyTypes.map((t) => t.id));
  const mergedTypes = [...companyTypes, ...locallyCreatedTypes.filter((t) => !knownTypeIds.has(t.id))];
  const typeOptions = buildTaxonomyOptions(mergedTypes, selectedType);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok && company) {
      onSaved?.();
    }
    wasPending.current = pending;
  }, [pending, state.ok, company, onSaved]);

  function handleCreateType() {
    setTypeError(null);
    startTypeTransition(async () => {
      const result = await createCompanyTypeInline(newTypeLabel);
      if (!result.ok) {
        setTypeError(result.error);
        return;
      }
      setLocallyCreatedTypes((prev) => [
        ...prev,
        { id: result.id, name: result.name, label: result.label, sort_order: 0 },
      ]);
      setSelectedType(result.name);
      setNewTypeLabel("");
      setCreatingType(false);
    });
  }

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
        <div className="flex items-center justify-between">
          <label className={labelClass} htmlFor={`type-${idSuffix}`}>
            Type
          </label>
          <Link
            href="/admin/companies/types"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium text-veridan-accent-text underline underline-offset-2 hover:text-veridan-ink"
          >
            Manage types
          </Link>
        </div>
        <select
          id={`type-${idSuffix}`}
          name="type"
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className={`${inputClass} mt-1`}
        >
          {typeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {!creatingType ? (
          <button
            type="button"
            onClick={() => setCreatingType(true)}
            className="mt-1 text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            + New type
          </button>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale p-2">
            <input
              type="text"
              value={newTypeLabel}
              onChange={(e) => setNewTypeLabel(e.target.value)}
              placeholder="Type label"
              className={`${inputClass} max-w-[12rem]`}
            />
            <button
              type="button"
              onClick={handleCreateType}
              disabled={typePending || !newTypeLabel.trim()}
              className="rounded-md bg-veridan-ink px-3 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper disabled:opacity-50"
            >
              {typePending ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatingType(false);
                setTypeError(null);
              }}
              className="text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
            >
              Cancel
            </button>
            {typeError && (
              <p role="alert" className="w-full text-xs text-red-600">
                {typeError}
              </p>
            )}
          </div>
        )}
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

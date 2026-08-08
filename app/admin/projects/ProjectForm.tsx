"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { COMPANY_TYPES, PROJECT_TYPES, type CompanyRow } from "@/lib/supabase/types";
import { mergeLocallyCreated } from "@/lib/admin/creatableSelect";
import { CreatableSelect, InlineCreatePanel } from "@/components/admin/CreatableSelect";
import { createProject, type ProjectFormResult } from "./actions";
import { createCompanyInline } from "./companyQuickCreate";

const initialProjectFormResult: ProjectFormResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

const TYPE_LABELS: Record<string, string> = {
  new_construction: "New construction",
  retrofit: "Retrofit",
};

const COMPANY_TYPE_LABELS: Record<string, string> = {
  architect: "Architect",
  contractor: "Contractor",
  owner: "Owner",
  fm: "Facilities Management",
  supplier_contact: "Supplier contact",
};

export function ProjectForm({ companies }: { companies: CompanyRow[] }) {
  const [state, formAction, pending] = useActionState(createProject, initialProjectFormResult);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  // Inline "+ Create new company" quick-create, as the LAST OPTION of the
  // Company dropdown (founder feedback 2026-08-07 — see
  // lib/admin/creatableSelect.ts's header for the verbatim quote; this
  // was previously a separate "+ New company" button beside the select).
  // Kept local to this form instance, same shape as ProductForm's
  // item-group inline quick-create — companies created here are tracked
  // separately and merged with the server-provided `companies` prop at
  // render time so a company created moments ago is selectable
  // immediately, without waiting on the next server round-trip.
  const [locallyCreatedCompanies, setLocallyCreatedCompanies] = useState<CompanyRow[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyType, setNewCompanyType] = useState<string>(COMPANY_TYPES[0]);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companyPending, startCompanyTransition] = useTransition();

  const allCompanies = mergeLocallyCreated(companies, locallyCreatedCompanies);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      formRef.current?.reset();
      setSelectedCompanyId("");
      setLocallyCreatedCompanies([]);
    }
    wasPending.current = pending;
  }, [pending, state.ok]);

  function handleCreateCompany() {
    setCompanyError(null);
    startCompanyTransition(async () => {
      const result = await createCompanyInline(newCompanyName, newCompanyType);
      if (!result.ok) {
        setCompanyError(result.error);
        return;
      }
      setLocallyCreatedCompanies((prev) => [
        ...prev,
        {
          id: result.id,
          name: result.name,
          type: newCompanyType as CompanyRow["type"],
          status: "new",
          completed_order_count: 0,
          notes: null,
          created_at: "",
          updated_at: "",
        },
      ]);
      setSelectedCompanyId(result.id);
      setNewCompanyName("");
      setNewCompanyType(COMPANY_TYPES[0]);
      setCreatingCompany(false);
    });
  }

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="project-name">
          Project name
        </label>
        <input id="project-name" type="text" name="name" required className={`${inputClass} mt-1`} />
      </div>

      <div>
        <label className={labelClass} htmlFor="project-company">
          Company
        </label>
        <CreatableSelect
          id="project-company"
          name="company_id"
          required
          value={selectedCompanyId}
          options={allCompanies.map((c) => ({ value: c.id, label: c.name }))}
          onChange={setSelectedCompanyId}
          onRequestCreate={() => setCreatingCompany(true)}
          createOptionLabel="+ Create new company"
          leadingOption={{ value: "", label: "Choose a company…", disabled: true }}
        />
        {creatingCompany && (
          <InlineCreatePanel
            onCancel={() => {
              setCreatingCompany(false);
              setCompanyError(null);
            }}
            onSubmit={handleCreateCompany}
            pending={companyPending}
            error={companyError}
            submitDisabled={!newCompanyName.trim()}
          >
            <input
              type="text"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              placeholder="Company name"
              aria-label="New company name"
              autoFocus
              className={`${inputClass} max-w-[12rem]`}
            />
            <select
              value={newCompanyType}
              onChange={(e) => setNewCompanyType(e.target.value)}
              className={`${inputClass} max-w-[10rem]`}
              aria-label="New company type"
            >
              {COMPANY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COMPANY_TYPE_LABELS[t] ?? t}
                </option>
              ))}
            </select>
          </InlineCreatePanel>
        )}
      </div>

      <div>
        <label className={labelClass} htmlFor="project-type">
          Type
        </label>
        <select id="project-type" name="project_type" defaultValue="new_construction" className={`${inputClass} mt-1`}>
          {PROJECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="project-site-address">
          Site address
        </label>
        <input id="project-site-address" type="text" name="site_address" className={`${inputClass} mt-1`} />
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending || allCompanies.length === 0}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Add project"}
        </button>
        {allCompanies.length === 0 && (
          <p className="text-xs text-veridan-warm-gray">
            No companies yet — choose “+ Create new company” from the dropdown above.
          </p>
        )}
        {state.ok === false && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

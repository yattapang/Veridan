"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { COMPANY_TYPES, PROJECT_TYPES, type CompanyRow } from "@/lib/supabase/types";
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

  // Inline "+ New company" quick-create (founder-reported: the Company
  // cell only offered existing companies). Kept local to this form
  // instance, same shape as ProductForm's item-group inline quick-create —
  // companies created here are tracked separately and merged with the
  // server-provided `companies` prop at render time so a company created
  // moments ago is selectable immediately, without waiting on the next
  // server round-trip.
  const [locallyCreatedCompanies, setLocallyCreatedCompanies] = useState<CompanyRow[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyType, setNewCompanyType] = useState<string>(COMPANY_TYPES[0]);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companyPending, startCompanyTransition] = useTransition();

  const knownCompanyIds = new Set(companies.map((c) => c.id));
  const allCompanies = [
    ...companies,
    ...locallyCreatedCompanies.filter((c) => !knownCompanyIds.has(c.id)),
  ];

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
        <select
          id="project-company"
          name="company_id"
          required
          value={selectedCompanyId}
          onChange={(e) => setSelectedCompanyId(e.target.value)}
          className={`${inputClass} mt-1`}
        >
          <option value="" disabled>
            Choose a company…
          </option>
          {allCompanies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {!creatingCompany ? (
          <button
            type="button"
            onClick={() => setCreatingCompany(true)}
            className="mt-1 text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            + New company
          </button>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale p-2">
            <input
              type="text"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              placeholder="Company name"
              aria-label="New company name"
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
            <button
              type="button"
              onClick={handleCreateCompany}
              disabled={companyPending || !newCompanyName.trim()}
              className="rounded-md bg-veridan-ink px-3 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper disabled:opacity-50"
            >
              {companyPending ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatingCompany(false);
                setCompanyError(null);
              }}
              className="text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
            >
              Cancel
            </button>
            {companyError && (
              <p role="alert" className="w-full text-xs text-red-600">
                {companyError}
              </p>
            )}
          </div>
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
            No companies yet — use “+ New company” above.
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

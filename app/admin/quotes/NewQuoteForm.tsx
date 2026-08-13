"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { COMPANY_TYPES, type CompanyRow } from "@/lib/supabase/types";
import { mergeLocallyCreated } from "@/lib/admin/creatableSelect";
import { CreatableSelect, InlineCreatePanel } from "@/components/admin/CreatableSelect";
import { createCompanyInline } from "@/app/admin/projects/companyQuickCreate";
import { createQuoteDirect } from "./newQuoteActions";
import type { ProjectActionResult } from "@/app/admin/projects/[id]/actions";

const initialResult: ProjectActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

const COMPANY_TYPE_LABELS: Record<string, string> = {
  architect: "Architect",
  contractor: "Contractor",
  owner: "Owner",
  fm: "Facilities Management",
  supplier_contact: "Supplier contact",
};

/** Minimal shape passed down from the server component — no cost fields. */
export interface QuoteProjectOption {
  id: string;
  name: string;
  company_id: string;
}

/**
 * "New quote" on the Quotes tab (Admin: create quotes directly, without a
 * project). Company picking mirrors app/admin/projects/ProjectForm.tsx's
 * "+ Create new company" CreatableSelect exactly (same component, same
 * inline quick-create action) — the founder's stated requirement was that
 * client info can be added "from inside the field", and that pattern is
 * already established there.
 *
 * Project attachment is optional: the project <select> lists only the
 * chosen company's existing (non-archived) projects, defaulting to "— none
 * (create a lightweight project) —". Submitting with that default leaves
 * `project_id` unset, so app/admin/companies/[id]/quoteActions.ts#
 * createRetrofitQuoteForCompany falls through to its existing
 * lightweight-project-creation path — the same one CompanyQuoteForm uses —
 * using the `project_name`/`site_address` fields below for that new
 * project's name/address. Choosing an existing project instead hides those
 * two fields (they'd be ignored) and sends `project_id`.
 */
export function NewQuoteForm({
  companies,
  projects,
}: {
  companies: CompanyRow[];
  projects: QuoteProjectOption[];
}) {
  const [state, formAction, pending] = useActionState(createQuoteDirect, initialResult);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  const [locallyCreatedCompanies, setLocallyCreatedCompanies] = useState<CompanyRow[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(companies.length === 0);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyType, setNewCompanyType] = useState<string>(COMPANY_TYPES[0]);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companyPending, startCompanyTransition] = useTransition();
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const allCompanies = mergeLocallyCreated(companies, locallyCreatedCompanies);
  const companyProjects = useMemo(
    () => projects.filter((p) => p.company_id === selectedCompanyId),
    [projects, selectedCompanyId]
  );

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      formRef.current?.reset();
      setSelectedCompanyId("");
      setLocallyCreatedCompanies([]);
      setSelectedProjectId("");
    }
    wasPending.current = pending;
  }, [pending, state.ok]);

  // A different company invalidates whatever project was picked for the
  // previous one — the option list itself already filters this out, but
  // clearing the selection avoids submitting a stale project_id. Done as a
  // wrapped setter (not a useEffect keyed on selectedCompanyId) so the reset
  // happens in the same event, not a follow-up render.
  function handleCompanyChange(next: string) {
    setSelectedCompanyId(next);
    setSelectedProjectId("");
  }

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
      handleCompanyChange(result.id);
      setNewCompanyName("");
      setNewCompanyType(COMPANY_TYPES[0]);
      setCreatingCompany(false);
    });
  }

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      {selectedProjectId && <input type="hidden" name="project_id" value={selectedProjectId} />}

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="quote-company">
          Company
        </label>
        <CreatableSelect
          id="quote-company"
          name="company_id"
          required
          value={selectedCompanyId}
          options={allCompanies.map((c) => ({ value: c.id, label: c.name }))}
          onChange={handleCompanyChange}
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

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="quote-project">
          Project (optional)
        </label>
        <select
          id="quote-project"
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          disabled={!selectedCompanyId || companyProjects.length === 0}
          className={`${inputClass} mt-1 disabled:opacity-60`}
        >
          <option value="">— None (create a lightweight project) —</option>
          {companyProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          {!selectedCompanyId
            ? "Choose a company to see its existing projects."
            : companyProjects.length === 0
              ? "No existing projects for this company — a lightweight project will be created automatically."
              : "Leave as “None” to create a small standalone project for this quote."}
        </p>
      </div>

      {!selectedProjectId && (
        <>
          <div>
            <label className={labelClass} htmlFor="quote-project-name">
              Project / job name
            </label>
            <input
              id="quote-project-name"
              type="text"
              name="project_name"
              placeholder="Optional — auto-named if left blank"
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="quote-site-address">
              Site address
            </label>
            <input
              id="quote-site-address"
              type="text"
              name="site_address"
              placeholder="Optional"
              className={`${inputClass} mt-1`}
            />
          </div>
        </>
      )}

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending || allCompanies.length === 0}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating quote…" : "Create quote"}
        </button>
        {allCompanies.length === 0 && (
          <p className="text-xs text-veridan-warm-gray">
            No companies yet — choose “+ Create new company” from the dropdown above.
          </p>
        )}
        {state.ok === false && (
          <p role="alert" className="max-w-md text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

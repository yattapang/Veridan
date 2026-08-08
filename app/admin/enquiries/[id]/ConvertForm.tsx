"use client";

import { useActionState, useState } from "react";
import { COMPANY_TYPES, type CompanyRow, type EnquiryRow } from "@/lib/supabase/types";
import { CreatableSelect, InlineCreatePanel } from "@/components/admin/CreatableSelect";
import { convertEnquiryToProject, type ConvertResult } from "./actions";

const initialConvertResult: ConvertResult = { ok: true };

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
 * Enquiry -> project conversion form (Task 13). The company picker used to
 * be an "existing vs. new" mode toggle above a client-side search list.
 * Founder feedback 2026-08-07 (see lib/admin/creatableSelect.ts's header)
 * asked for every "create a new X" affordance to live INSIDE its dropdown,
 * as the last option, rather than beside/above it — so this is now a
 * single CreatableSelect of companies whose trailing option is
 * "+ Create new company".
 *
 * Choosing that option does NOT create the company immediately (unlike
 * the other quick-create pickers in this app): this form's own submit
 * (convertEnquiryToProject) creates the company, its auto-derived primary
 * contact, and the project together in one action — see that action's
 * `mode === "new"` branch. Duplicating that as a separate quick-create
 * action would either drop the auto-created primary contact or duplicate
 * the creation logic, so the inline panel here just reveals the
 * new-company fields (name + type) as part of THIS form; "Cancel" reverts
 * to picking an existing company, and there is no inline Save button
 * (nothing to save yet — the whole form saves together).
 */
export function ConvertForm({
  enquiry,
  companies,
}: {
  enquiry: EnquiryRow;
  companies: CompanyRow[];
}) {
  const [state, formAction, pending] = useActionState(
    convertEnquiryToProject.bind(null, enquiry.id),
    initialConvertResult
  );
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  // Default straight to "create new" when there are no companies to pick
  // from — otherwise the picker starts with nothing selectable and the
  // submit button starts disabled, which reads as "the button doesn't
  // work" (real founder-reported trap this mirrors from before).
  const [creatingCompany, setCreatingCompany] = useState(companies.length === 0);

  const canSubmit = creatingCompany || Boolean(selectedCompanyId);

  const defaultProjectName = enquiry.company_name
    ? `${enquiry.company_name} — ${enquiry.pathway === "retrofit" ? "Retrofit" : "New Construction"}`
    : `${enquiry.contact_name} — ${enquiry.pathway === "retrofit" ? "Retrofit" : "New Construction"}`;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="mode" value={creatingCompany ? "new" : "existing"} />
      {!creatingCompany && selectedCompanyId && (
        <input type="hidden" name="company_id" value={selectedCompanyId} />
      )}

      <div>
        <label className={labelClass} htmlFor="company-select">
          Company
        </label>
        <CreatableSelect
          id="company-select"
          value={selectedCompanyId}
          options={companies.map((c) => ({
            value: c.id,
            label: `${c.name} (${TYPE_LABELS[c.type] ?? c.type})`,
          }))}
          onChange={setSelectedCompanyId}
          onRequestCreate={() => setCreatingCompany(true)}
          createOptionLabel="+ Create new company"
          leadingOption={{ value: "", label: "Choose a company…", disabled: true }}
        />

        {creatingCompany && (
          <InlineCreatePanel onCancel={() => setCreatingCompany(false)}>
            <div className="grid w-full gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="new-company-name">
                  New company name
                </label>
                <input
                  id="new-company-name"
                  type="text"
                  name="new_company_name"
                  required
                  autoFocus
                  defaultValue={enquiry.company_name ?? ""}
                  className={`${inputClass} mt-1`}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="new-company-type">
                  Type
                </label>
                <select
                  id="new-company-type"
                  name="new_company_type"
                  defaultValue="architect"
                  className={`${inputClass} mt-1`}
                >
                  {COMPANY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-veridan-warm-gray sm:col-span-2">
                A primary contact will be created automatically from the
                enquiry&apos;s submitted info: {enquiry.contact_name} ·{" "}
                {enquiry.contact_email}
                {enquiry.contact_phone ? ` · ${enquiry.contact_phone}` : ""}.
              </p>
            </div>
          </InlineCreatePanel>
        )}
      </div>

      <div className="grid gap-4 border-t border-veridan-warm-gray-light pt-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="project-name">
            Project name
          </label>
          <input
            id="project-name"
            type="text"
            name="project_name"
            required
            defaultValue={defaultProjectName}
            className={`${inputClass} mt-1`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="site-address">
            Site address
          </label>
          <input
            id="site-address"
            type="text"
            name="site_address"
            defaultValue=""
            placeholder="Optional"
            className={`${inputClass} mt-1`}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending || !canSubmit}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Converting…" : "Convert to project"}
        </button>
        {state.ok === false ? (
          <p role="alert" className="max-w-md text-xs text-red-600">
            {state.error}
          </p>
        ) : !canSubmit && !pending ? (
          <p className="max-w-md text-xs text-veridan-warm-gray">
            Choose a company from the dropdown above (or “+ Create new company”) to
            enable this button.
          </p>
        ) : null}
      </div>
    </form>
  );
}

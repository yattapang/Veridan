"use client";

import { useActionState, useState } from "react";
import { COMPANY_TYPES, type CompanyRow, type EnquiryRow } from "@/lib/supabase/types";
import { CreatableSelect, InlineCreatePanel } from "@/components/admin/CreatableSelect";
import { convertEnquiryToQuote, type ConvertResult } from "./actions";

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
 * Enquiry -> quote, directly (the founder's "shorter path" for a small
 * order — Admin: create quotes directly, without a project). Deliberately
 * the same company picker as ConvertForm.tsx (this file's sibling): the
 * same CreatableSelect, the same "reveal name+type fields inline, defer the
 * actual insert to the whole form's submit" behaviour, because
 * ./actions.ts#convertEnquiryToQuote reuses the exact same
 * resolveOrCreateCompanyForEnquiry step convertEnquiryToProject uses. There
 * is no project-name/site-address step here — unlike the project
 * conversion, this path auto-names a lightweight project behind the scenes
 * (see that action's comment for why one still has to exist) and goes
 * straight to the quote builder.
 */
export function ConvertToQuoteForm({
  enquiry,
  companies,
}: {
  enquiry: EnquiryRow;
  companies: CompanyRow[];
}) {
  const [state, formAction, pending] = useActionState(
    convertEnquiryToQuote.bind(null, enquiry.id),
    initialConvertResult
  );
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(companies.length === 0);

  const canSubmit = creatingCompany || Boolean(selectedCompanyId);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="mode" value={creatingCompany ? "new" : "existing"} />
      {!creatingCompany && selectedCompanyId && (
        <input type="hidden" name="company_id" value={selectedCompanyId} />
      )}

      <div>
        <label className={labelClass} htmlFor="quote-convert-company-select">
          Company
        </label>
        <CreatableSelect
          id="quote-convert-company-select"
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
                <label className={labelClass} htmlFor="quote-convert-new-company-name">
                  New company name
                </label>
                <input
                  id="quote-convert-new-company-name"
                  type="text"
                  name="new_company_name"
                  required
                  autoFocus
                  defaultValue={enquiry.company_name ?? ""}
                  className={`${inputClass} mt-1`}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="quote-convert-new-company-type">
                  Type
                </label>
                <select
                  id="quote-convert-new-company-type"
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

      <div className="flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending || !canSubmit}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating quote…" : "Create quote"}
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

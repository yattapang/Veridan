"use client";

import { useActionState, useMemo, useState } from "react";
import { COMPANY_TYPES, type CompanyRow, type EnquiryRow } from "@/lib/supabase/types";
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
 * Enquiry -> project conversion form (Task 13). Company search is a
 * client-side filter over the full `companies` list passed in from the
 * server component — simpler and snappier than a round-trip search for
 * the company counts this app expects, and keeps this within the
 * existing "pass full reference lists as props" pattern already used by
 * ProductForm/SupplierForm.
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
  // Default to "create new" when there are no companies to pick from —
  // otherwise the submit button starts disabled with nothing selectable,
  // which reads as "the button doesn't work" (real founder-reported trap).
  const [mode, setMode] = useState<"existing" | "new">(
    companies.length > 0 ? "existing" : "new"
  );
  const [query, setQuery] = useState(enquiry.company_name ?? "");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? companies.filter((c) => c.name.toLowerCase().includes(q)) : companies;
    return list.slice(0, 20);
  }, [query, companies]);

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? null;
  const canSubmit = mode === "new" || Boolean(selectedCompanyId);

  const defaultProjectName = enquiry.company_name
    ? `${enquiry.company_name} — ${enquiry.pathway === "retrofit" ? "Retrofit" : "New Construction"}`
    : `${enquiry.contact_name} — ${enquiry.pathway === "retrofit" ? "Retrofit" : "New Construction"}`;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="mode" value={mode} />
      {mode === "existing" && selectedCompanyId && (
        <input type="hidden" name="company_id" value={selectedCompanyId} />
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("existing")}
          aria-pressed={mode === "existing"}
          className={`rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-wide ${
            mode === "existing"
              ? "bg-veridan-ink text-veridan-paper"
              : "border border-veridan-warm-gray-light text-veridan-ink/70 hover:text-veridan-ink"
          }`}
        >
          Use existing company
        </button>
        <button
          type="button"
          onClick={() => setMode("new")}
          aria-pressed={mode === "new"}
          className={`rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-wide ${
            mode === "new"
              ? "bg-veridan-ink text-veridan-paper"
              : "border border-veridan-warm-gray-light text-veridan-ink/70 hover:text-veridan-ink"
          }`}
        >
          Create new company
        </button>
      </div>

      {mode === "existing" ? (
        <div>
          <label className={labelClass} htmlFor="company-search">
            Search companies by name
          </label>
          <input
            id="company-search"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedCompanyId(null);
            }}
            placeholder="Start typing a company name…"
            className={`${inputClass} mt-1`}
          />
          {filtered.length === 0 ? (
            <p className="mt-2 text-xs text-veridan-warm-gray">
              No companies match.{" "}
              <button
                type="button"
                onClick={() => setMode("new")}
                className="font-medium text-veridan-ink underline underline-offset-2"
              >
                Create a new company instead
              </button>
              .
            </p>
          ) : (
            <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border border-veridan-warm-gray-light">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCompanyId(c.id);
                      setQuery(c.name);
                    }}
                    aria-pressed={selectedCompanyId === c.id}
                    className={`block w-full px-3 py-2 text-left text-sm ${
                      selectedCompanyId === c.id
                        ? "bg-veridan-ink text-veridan-paper"
                        : "text-veridan-ink hover:bg-veridan-warm-gray-pale"
                    }`}
                  >
                    {c.name}{" "}
                    <span className="text-xs opacity-70">({TYPE_LABELS[c.type] ?? c.type})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selectedCompany && (
            <p className="mt-2 text-xs text-veridan-warm-gray">
              Selected: <span className="font-medium text-veridan-ink">{selectedCompany.name}</span>
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="new-company-name">
              New company name
            </label>
            <input
              id="new-company-name"
              type="text"
              name="new_company_name"
              required
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
      )}

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
            Select a company from the list above (or create a new one) to
            enable this button.
          </p>
        ) : null}
      </div>
    </form>
  );
}

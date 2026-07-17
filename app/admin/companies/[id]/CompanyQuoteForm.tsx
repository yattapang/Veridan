"use client";

import { useActionState } from "react";
import { createRetrofitQuoteForCompany } from "./quoteActions";
import type { ProjectActionResult } from "@/app/admin/projects/[id]/actions";

const initialCompanyQuoteActionResult: ProjectActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Starts a retrofit (line_item mode) quote straight from the company page
 * (Task 17) — for jobs that don't warrant a full project record. Creates a
 * lightweight 'retrofit' project under this company and an empty line_item
 * quote in one action, then redirects into the builder to add lines.
 */
export function CompanyQuoteForm({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [state, formAction, pending] = useActionState(
    createRetrofitQuoteForCompany.bind(null, companyId),
    initialCompanyQuoteActionResult
  );

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass} htmlFor="project_name">
          Project / job name
        </label>
        <input
          id="project_name"
          type="text"
          name="project_name"
          placeholder={`Retrofit — ${companyName} — today`}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="site_address">
          Site address
        </label>
        <input id="site_address" type="text" name="site_address" className={`${inputClass} mt-1`} />
      </div>
      <div className="sm:col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating quote…" : "Create quote (Line-item mode)"}
        </button>
        <p className="text-xs text-veridan-warm-gray">
          Creates a lightweight retrofit project under this company, then an empty quote to add lines to.
        </p>
      </div>
      {state.ok === false && (
        <p role="alert" className="sm:col-span-2 text-xs text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}

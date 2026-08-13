"use server";

import { createRetrofitQuoteForCompany } from "@/app/admin/companies/[id]/quoteActions";
import type { ProjectActionResult } from "@/app/admin/projects/[id]/actions";

/**
 * "New quote" on the Quotes tab (Admin: create quotes directly, without a
 * project) — lets a quote be started for a client with no project, from the
 * Quotes tab itself rather than only from a project or company page.
 *
 * This is a thin dispatcher, NOT a second quote-creation pipeline: the
 * company here is chosen dynamically in the form (existing company, or one
 * created inline moments earlier via the same createCompanyInline quick-
 * create used by ProjectForm), so it travels as a `company_id` field in
 * `formData` rather than as a bound argument the way CompanyQuoteForm binds
 * it (`createRetrofitQuoteForCompany.bind(null, companyId)`, which requires
 * the company id to be known before render). This just reads that field and
 * hands off to the SAME action CompanyQuoteForm calls
 * (app/admin/companies/[id]/quoteActions.ts#createRetrofitQuoteForCompany),
 * which re-validates the company itself and — per that action's own optional
 * `project_id` field — either attaches to an existing project or creates a
 * lightweight one, identically to the company-page flow.
 */
export async function createQuoteDirect(
  _prevState: ProjectActionResult,
  formData: FormData
): Promise<ProjectActionResult> {
  const companyId = String(formData.get("company_id") ?? "").trim();
  if (!companyId) {
    return { ok: false, error: "Choose a company, or create one, before continuing." };
  }
  return createRetrofitQuoteForCompany(companyId, _prevState, formData);
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { createLineItemQuote, type ProjectActionResult } from "@/app/admin/projects/[id]/actions";

export const initialCompanyQuoteActionResult: ProjectActionResult = { ok: true };

/**
 * Retrofit/simple jobs (line_item mode, §6.2) don't always warrant a full
 * project the way a new-construction door register does — but
 * quotes.project_id is NOT NULL (§1.7), so there's no schema path to a
 * project-less quote. Per the Task 17 brief ("create a lightweight project
 * under the company in the same action and note it; do whatever the schema
 * permits with minimal ceremony"), this creates a minimal 'retrofit' project
 * under the company (auto-named unless the founder supplies one) and then
 * hands off to the SAME createLineItemQuote pipeline a project page's
 * "Create quote (Line-item mode)" button uses — no duplicated quote-creation
 * logic, just one extra project insert in front of it.
 */
export async function createRetrofitQuoteForCompany(
  companyId: string,
  _prevState: ProjectActionResult,
  formData: FormData
): Promise<ProjectActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) return { ok: false, error: `Could not load the company: ${companyError.message}` };
  if (!company) return { ok: false, error: "Company not found." };

  const projectNameRaw = String(formData.get("project_name") ?? "").trim();
  const siteAddress = String(formData.get("site_address") ?? "").trim();
  const today = new Date().toISOString().slice(0, 10);
  const projectName = projectNameRaw || `Retrofit — ${company.name} — ${today}`;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      company_id: companyId,
      name: projectName,
      site_address: siteAddress || null,
      project_type: "retrofit",
      status: "active",
    })
    .select("id")
    .single();
  if (projectError || !project) {
    return {
      ok: false,
      error: `Could not create a project for this quote: ${projectError?.message ?? "unknown error"}`,
    };
  }

  // createLineItemQuote redirects into the new quote's builder on success
  // (throwing Next's redirect signal), or returns an error result — either
  // way this propagates straight through.
  return createLineItemQuote(project.id as string);
}

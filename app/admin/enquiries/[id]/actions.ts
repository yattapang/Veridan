"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { COMPANY_TYPES, type CompanyType, type EnquiryRow } from "@/lib/supabase/types";
import { createLineItemQuoteRecord } from "@/app/admin/projects/[id]/actions";

export type ConvertResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

function isCompanyType(value: unknown): value is CompanyType {
  return typeof value === "string" && (COMPANY_TYPES as string[]).includes(value);
}

/** Splits a single "contact_name" field into first/last for the contacts table. */
function splitName(fullName: string): { first_name: string; last_name: string | null } {
  const trimmed = fullName.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { first_name: trimmed, last_name: null };
  return {
    first_name: trimmed.slice(0, spaceIdx),
    last_name: trimmed.slice(spaceIdx + 1).trim() || null,
  };
}

interface CompanyResolution {
  companyId: string;
  primaryContactId: string | null;
  createdNewCompany: boolean;
}

type CompanyResolutionResult =
  | { ok: true; resolution: CompanyResolution }
  | { ok: false; error: string };

/**
 * Shared "pick an existing company, or create one + its primary contact
 * from the enquiry's submitted info" step, factored out of
 * convertEnquiryToProject so convertEnquiryToQuote (below) can reuse it
 * exactly rather than re-implementing the same mode toggle / company insert
 * / best-effort contact creation a second time. Both callers use the same
 * ConvertForm-style CreatableSelect UI (mode="new" | "existing" + the
 * matching form fields), so the FormData shape this reads is shared too.
 */
async function resolveOrCreateCompanyForEnquiry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  enquiry: EnquiryRow,
  formData: FormData
): Promise<CompanyResolutionResult> {
  const mode = String(formData.get("mode") ?? "existing");

  if (mode === "new") {
    const newCompanyName = String(formData.get("new_company_name") ?? "").trim();
    const newCompanyType = formData.get("new_company_type");

    if (!newCompanyName) {
      return { ok: false, error: "Enter a name for the new company." };
    }
    if (!isCompanyType(newCompanyType)) {
      return { ok: false, error: "Choose a valid company type." };
    }

    const { data: newCompany, error: companyError } = await supabase
      .from("companies")
      .insert({ name: newCompanyName, type: newCompanyType, status: "new" })
      .select("id")
      .single();

    if (companyError || !newCompany) {
      return {
        ok: false,
        error: `Could not create the company: ${companyError?.message ?? "unknown error"}.`,
      };
    }

    const companyId = newCompany.id as string;

    // Best-effort: create the primary contact from the enquiry's submitted
    // info. A failure here is non-critical (the company still exists and
    // staff can add a contact from the company page), so it doesn't abort
    // the conversion — mirrors the enquiry-notification-email pattern in
    // lib/enquiries/submit.ts (secondary step failing must not block the
    // primary one).
    const { first_name, last_name } = splitName(enquiry.contact_name);
    const { data: newContact, error: contactError } = await supabase
      .from("contacts")
      .insert({
        company_id: companyId,
        first_name,
        last_name,
        email: enquiry.contact_email || null,
        phone: enquiry.contact_phone || null,
        is_primary: true,
      })
      .select("id")
      .single();

    let primaryContactId: string | null = null;
    if (contactError) {
      console.error("[veridan:enquiries-convert] Contact creation failed (non-fatal):", contactError);
    } else {
      primaryContactId = newContact.id as string;
    }

    return { ok: true, resolution: { companyId, primaryContactId, createdNewCompany: true } };
  }

  const companyIdRaw = String(formData.get("company_id") ?? "").trim();
  if (!companyIdRaw) {
    return {
      ok: false,
      error: "Search for and select an existing company, or switch to “create new”.",
    };
  }
  return {
    ok: true,
    resolution: { companyId: companyIdRaw, primaryContactId: null, createdNewCompany: false },
  };
}

/** Loads the enquiry and re-checks the two invariants both conversion flows share. */
async function loadConvertibleEnquiry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  enquiryId: string
): Promise<{ ok: true; enquiry: EnquiryRow } | { ok: false; error: string }> {
  const { data: enquiry, error: enquiryError } = await supabase
    .from("enquiries")
    .select("*")
    .eq("id", enquiryId)
    .maybeSingle();

  if (enquiryError) {
    return { ok: false, error: `Could not load the enquiry: ${enquiryError.message}` };
  }
  if (!enquiry) {
    return { ok: false, error: "This enquiry no longer exists." };
  }
  if (enquiry.status === "converted") {
    return { ok: false, error: "This enquiry has already been converted." };
  }
  return { ok: true, enquiry: enquiry as EnquiryRow };
}

/**
 * Enquiry-to-project conversion (Task 13). Pick-or-create a company, then
 * create the project row linked to it + the enquiry, then mark the
 * enquiry converted. Not a real DB transaction (Supabase's JS client has
 * no multi-statement transaction API from a Server Action) — run
 * sequentially and surface exactly what succeeded/failed if a later step
 * breaks, per the build brief ("transactional-ish ... on partial failure
 * surface clearly").
 */
export async function convertEnquiryToProject(
  enquiryId: string,
  _prevState: ConvertResult,
  formData: FormData
): Promise<ConvertResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to convert an enquiry." };

  const enquiryResult = await loadConvertibleEnquiry(supabase, enquiryId);
  if (!enquiryResult.ok) return { ok: false, error: enquiryResult.error };
  const { enquiry } = enquiryResult;

  const projectName = String(formData.get("project_name") ?? "").trim();
  const siteAddress = String(formData.get("site_address") ?? "").trim();

  if (!projectName) {
    return { ok: false, error: "Project name is required." };
  }

  const companyResult = await resolveOrCreateCompanyForEnquiry(supabase, enquiry, formData);
  if (!companyResult.ok) return { ok: false, error: companyResult.error };
  const { companyId, primaryContactId, createdNewCompany } = companyResult.resolution;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      company_id: companyId,
      primary_contact_id: primaryContactId,
      architect_company_id: null,
      name: projectName,
      site_address: siteAddress || null,
      project_type: enquiry.pathway,
      status: "active",
      enquiry_id: enquiry.id,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    const companyNote = createdNewCompany
      ? ` A new company record was created (id ${companyId}) before this failure — check /admin/companies/${companyId} rather than creating a duplicate.`
      : "";
    return {
      ok: false,
      error: `Could not create the project: ${projectError?.message ?? "unknown error"}.${companyNote}`,
    };
  }

  const { error: updateEnquiryError } = await supabase
    .from("enquiries")
    .update({ status: "converted", project_id: project.id, matched_company_id: companyId })
    .eq("id", enquiryId);

  if (updateEnquiryError) {
    return {
      ok: false,
      error: `The project was created (id ${project.id}), but marking the enquiry as converted failed: ${updateEnquiryError.message}. Open /admin/projects/${project.id} to confirm it, then update the enquiry status manually.`,
    };
  }

  revalidatePath("/admin/enquiries");
  revalidatePath(`/admin/enquiries/${enquiryId}`);
  revalidatePath("/admin/projects");
  redirect(`/admin/projects/${project.id}`);
}

/**
 * Enquiry-to-quote, directly (Admin: create quotes directly, without a
 * project) — the founder's "shorter path" for a small order that doesn't
 * warrant a full project: pick-or-create a company (same
 * resolveOrCreateCompanyForEnquiry step convertEnquiryToProject uses, so
 * this never re-implements that logic), then, since quotes.project_id is
 * NOT NULL (§1.7), create the SAME kind of lightweight auto-named project
 * app/admin/companies/[id]/quoteActions.ts#createRetrofitQuoteForCompany
 * creates for a company-page "create quote" — with `enquiry_id` set so the
 * project (and therefore the quote, transitively) links back to this
 * enquiry; `public.quotes` itself has no `enquiry_id` column, so
 * quote → project → enquiry is the only link the schema supports (see the
 * build report). Then hands off to the exact same
 * createLineItemQuoteRecord pipeline every other quote-creation path in
 * this app uses (app/admin/projects/[id]/actions.ts) — no separate
 * quote-creation logic — and marks the enquiry converted exactly as
 * convertEnquiryToProject does, so the existing status/workflow (StatusForm,
 * the "already converted" guard above) applies unchanged. Redirects straight
 * into the quote builder, skipping the project page entirely.
 */
export async function convertEnquiryToQuote(
  enquiryId: string,
  _prevState: ConvertResult,
  formData: FormData
): Promise<ConvertResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to convert an enquiry." };

  const enquiryResult = await loadConvertibleEnquiry(supabase, enquiryId);
  if (!enquiryResult.ok) return { ok: false, error: enquiryResult.error };
  const { enquiry } = enquiryResult;

  const companyResult = await resolveOrCreateCompanyForEnquiry(supabase, enquiry, formData);
  if (!companyResult.ok) return { ok: false, error: companyResult.error };
  const { companyId, primaryContactId, createdNewCompany } = companyResult.resolution;

  const today = new Date().toISOString().slice(0, 10);
  const projectName =
    (enquiry.company_name || enquiry.contact_name) + ` — Quote — ${today}`;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      company_id: companyId,
      primary_contact_id: primaryContactId,
      architect_company_id: null,
      name: projectName,
      site_address: null,
      project_type: enquiry.pathway,
      status: "active",
      enquiry_id: enquiry.id,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    const companyNote = createdNewCompany
      ? ` A new company record was created (id ${companyId}) before this failure — check /admin/companies/${companyId} rather than creating a duplicate.`
      : "";
    return {
      ok: false,
      error: `Could not create a project for this quote: ${projectError?.message ?? "unknown error"}.${companyNote}`,
    };
  }

  const projectId = project.id as string;

  const quoteResult = await createLineItemQuoteRecord(projectId);
  if (!quoteResult.ok) {
    return {
      ok: false,
      error: `A lightweight project was created (id ${projectId}), but the quote itself failed: ${quoteResult.error}. Open /admin/projects/${projectId} and create the quote from there.`,
    };
  }

  const { error: updateEnquiryError } = await supabase
    .from("enquiries")
    .update({ status: "converted", project_id: projectId, matched_company_id: companyId })
    .eq("id", enquiryId);

  if (updateEnquiryError) {
    return {
      ok: false,
      error: `The quote was created (open /admin/quotes/${quoteResult.quoteId}), but marking the enquiry as converted failed: ${updateEnquiryError.message}. Update the enquiry status manually.`,
    };
  }

  revalidatePath("/admin/enquiries");
  revalidatePath(`/admin/enquiries/${enquiryId}`);
  revalidatePath("/admin/quotes");
  redirect(`/admin/quotes/${quoteResult.quoteId}`);
}

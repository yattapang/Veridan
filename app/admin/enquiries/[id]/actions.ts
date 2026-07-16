"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { COMPANY_TYPES, type CompanyType } from "@/lib/supabase/types";

export type ConvertResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export const initialConvertResult: ConvertResult = { ok: true };

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

  const mode = String(formData.get("mode") ?? "existing");
  const projectName = String(formData.get("project_name") ?? "").trim();
  const siteAddress = String(formData.get("site_address") ?? "").trim();

  if (!projectName) {
    return { ok: false, error: "Project name is required." };
  }

  let companyId: string;
  let primaryContactId: string | null = null;
  let createdNewCompany = false;

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

    companyId = newCompany.id;
    createdNewCompany = true;

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

    if (contactError) {
      console.error("[veridan:enquiries-convert] Contact creation failed (non-fatal):", contactError);
    } else {
      primaryContactId = newContact.id;
    }
  } else {
    const companyIdRaw = String(formData.get("company_id") ?? "").trim();
    if (!companyIdRaw) {
      return { ok: false, error: "Search for and select an existing company, or switch to “create new”." };
    }
    companyId = companyIdRaw;
  }

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

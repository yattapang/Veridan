"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { COMPANY_TYPES, type CompanyType } from "@/lib/supabase/types";

export type CompanyQuickCreateResult =
  | { ok: true; id: string; name: string; error?: undefined }
  | { ok: false; error: string };

function isCompanyType(value: unknown): value is CompanyType {
  return typeof value === "string" && (COMPANY_TYPES as string[]).includes(value);
}

/**
 * Inline "+ New company" quick-create for the project form's company
 * selector (founder-reported: the Company cell only let you pick an
 * existing company). Colocated here rather than in
 * app/admin/companies/actions.ts so it doesn't collide with concurrent
 * work in that folder — inserts directly into `companies`, mirroring
 * ConvertForm's "create new company" mode
 * (app/admin/enquiries/[id]/ConvertForm.tsx) minus the enquiry-derived
 * primary contact, since there's no enquiry in this flow.
 *
 * `type` is CHECK-constrained in the DB to the five values in
 * COMPANY_TYPES (supabase/migrations/20260713000001_schema.sql); that
 * constant is the single place to update if the list ever changes.
 */
export async function createCompanyInline(
  name: string,
  type: string
): Promise<CompanyQuickCreateResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create a company." };

  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, error: "Company name is required." };
  if (!isCompanyType(type)) return { ok: false, error: "Choose a valid company type." };

  const { data, error } = await supabase
    .from("companies")
    .insert({ name: trimmedName, type, status: "new" })
    .select("id, name")
    .single();

  if (error || !data) {
    return { ok: false, error: `Could not create company: ${error?.message ?? "unknown error"}` };
  }

  revalidatePath("/admin/projects");
  revalidatePath("/admin/companies");
  return { ok: true, id: data.id as string, name: data.name as string };
}

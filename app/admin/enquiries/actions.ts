"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { ENQUIRY_STATUSES, type EnquiryStatus } from "@/lib/supabase/types";
import { buildManualEnquiryPayload } from "@/lib/enquiries/manualEntry";

export type EnquiryActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

function isEnquiryStatus(value: unknown): value is EnquiryStatus {
  return typeof value === "string" && (ENQUIRY_STATUSES as string[]).includes(value);
}

/**
 * Updates an enquiry's status (new/reviewing/converted/discarded, §1.12).
 * Conversion itself is a separate, richer flow
 * (app/admin/enquiries/[id]/actions.ts#convertEnquiryToProject) — this
 * action is for the simple manual transitions (e.g. new -> reviewing,
 * or discarding a spam/duplicate enquiry). Deliberately does not allow
 * setting status to 'converted' here, since that status must always come
 * with a project_id — use the convert flow for that transition.
 */
export async function updateEnquiryStatus(
  id: string,
  status: EnquiryStatus
): Promise<EnquiryActionResult> {
  if (!isEnquiryStatus(status)) {
    return { ok: false, error: "Choose a valid status." };
  }
  if (status === "converted") {
    return {
      ok: false,
      error: "Use the “Convert to project” action to mark an enquiry converted.",
    };
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to update an enquiry." };

  const { error } = await supabase.from("enquiries").update({ status }).eq("id", id);
  if (error) {
    return { ok: false, error: `Could not update enquiry status: ${error.message}` };
  }

  revalidatePath("/admin/enquiries");
  revalidatePath(`/admin/enquiries/${id}`);
  return { ok: true };
}

/**
 * "New enquiry" on the Enquiries tab — records an enquiry taken by phone,
 * email, or in person (founder-reported gap: today `enquiries` can only be
 * populated by the public quote-request portal). Uses the SAME payload
 * shape/validation as the two public forms via
 * lib/enquiries/manualEntry.ts#buildManualEnquiryPayload, and inserts with
 * status 'new' (identical to a fresh web submission), so a manually-created
 * enquiry flows through the existing review/convert pipeline unchanged —
 * StatusForm, ConvertForm, and the new direct-to-quote conversion all work
 * on it exactly as they would on a portal submission.
 *
 * Deliberately skips the public path's rate-limiting, honeypot handling,
 * file upload, and founder-notification email (lib/enquiries/submit.ts) —
 * none of those apply to an authenticated staff member typing in something
 * they just took a call about; rate-limiting in particular would be actively
 * wrong here (a staff member entering several enquiries in a short window
 * from the office IP should never be throttled the way an anonymous bot is).
 *
 * NOTE: `enquiries` has no source/channel column, so this manually-entered
 * row is stored indistinguishably from a web submission — see the build
 * report for why no migration was added for this.
 */
export async function createManualEnquiry(
  _prevState: EnquiryActionResult,
  formData: FormData
): Promise<EnquiryActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to record an enquiry." };

  const result = buildManualEnquiryPayload({
    pathway: String(formData.get("pathway") ?? ""),
    companyName: String(formData.get("company_name") ?? ""),
    contactName: String(formData.get("contact_name") ?? ""),
    contactEmail: String(formData.get("contact_email") ?? ""),
    contactPhone: String(formData.get("contact_phone") ?? ""),
    projectName: String(formData.get("project_name") ?? ""),
    siteLocation: String(formData.get("site_location") ?? ""),
    deliveryTimeframe: String(formData.get("delivery_timeframe") ?? ""),
    buildingType: String(formData.get("building_type") ?? ""),
    failingHardwareDescription: String(formData.get("failing_hardware_description") ?? ""),
    urgencyFlag: formData.get("urgency_flag") === "on",
    retrofitPathway: String(formData.get("retrofit_pathway") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });

  if (!result.ok) return { ok: false, error: result.error };

  const { data: inserted, error } = await supabase
    .from("enquiries")
    .insert({
      ...result.payload,
      uploaded_file_paths: null,
      honeypot_tripped: false,
      status: "new",
      matched_company_id: null,
      project_id: null,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { ok: false, error: `Could not record the enquiry: ${error?.message ?? "unknown error"}` };
  }

  revalidatePath("/admin/enquiries");
  redirect(`/admin/enquiries/${inserted.id}`);
}

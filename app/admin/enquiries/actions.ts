"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ENQUIRY_STATUSES, type EnquiryStatus } from "@/lib/supabase/types";

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

  const { error } = await supabase.from("enquiries").update({ status }).eq("id", id);
  if (error) {
    return { ok: false, error: `Could not update enquiry status: ${error.message}` };
  }

  revalidatePath("/admin/enquiries");
  revalidatePath(`/admin/enquiries/${id}`);
  return { ok: true };
}

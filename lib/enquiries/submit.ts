import "server-only";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { HONEYPOT_FIELD_NAME } from "@/lib/honeypot";
import { sendEnquiryNotification } from "@/lib/email";

/**
 * Shared enquiry-submission core used by both portal forms' server actions
 * (Task 8). Handles the parts that are identical for both pathways: rate
 * limiting, honeypot handling, the `enquiries` insert (anon, RLS-enforced —
 * see supabase/migrations/20260713000002_rls.sql for the exact policy this
 * must satisfy), optional file upload to Storage, and the best-effort
 * founder notification email. Each pathway's own server action is
 * responsible for parsing + validating its own FormData shape and building
 * the typed payload passed in here.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // ~10MB, per Task 8 brief

const ALLOWED_UPLOAD_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/csv",
  "application/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

const ALLOWED_UPLOAD_EXTENSIONS = [
  ".pdf",
  ".xls",
  ".xlsx",
  ".csv",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
];

function isAllowedUpload(file: File): boolean {
  if (ALLOWED_UPLOAD_TYPES.has(file.type)) return true;
  // Browsers/OSes are inconsistent about MIME type for .csv/.xlsx, so also
  // accept by extension as a fallback.
  const lowerName = file.name.toLowerCase();
  return ALLOWED_UPLOAD_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

export interface EnquiryInsertPayload {
  pathway: "new_construction" | "retrofit";
  company_name: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  project_details: string | null;
  delivery_timeframe: string | null;
  building_type: string | null;
  failing_hardware_description: string | null;
  urgency_flag: boolean;
  retrofit_pathway: string | null;
  line_items_structured: unknown | null;
}

export interface NotificationSummaryInput {
  summaryLines: Array<{ label: string; value: string }>;
}

export type SubmitEnquiryResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * `file` is the raw upload field value straight off FormData (may be a
 * zero-size File when no file was chosen, or null/absent for the retrofit
 * form which has no upload field at all).
 */
export async function submitEnquiry(
  payload: EnquiryInsertPayload,
  file: File | null,
  honeypotTripped: boolean,
  notification: NotificationSummaryInput
): Promise<SubmitEnquiryResult> {
  // Fail-open by design (Task 23): if IP extraction or the in-memory
  // limiter itself throws for any reason, log it and let the submission
  // through rather than blocking a legitimate visitor because of a bug in
  // the spam-control layer. Rejecting on a limiter error would turn an
  // availability bug into an outage for every real customer.
  try {
    const ip = await getClientIp();
    const rateLimit = checkRateLimit(`enquiry:${ip}`, 5, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      return {
        ok: false,
        error:
          "Too many submissions from this connection recently. Please wait a few minutes and try again, or email us directly.",
      };
    }
  } catch (err) {
    console.error("[enquiries] Rate limiter failed; failing open:", err);
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    console.error("[enquiries] Supabase not configured:", err);
    return {
      ok: false,
      error:
        "This form is temporarily unavailable. Please email us directly and we'll get your request started.",
    };
  }

  // Honeypot: a filled hidden field means a bot filled every input. Insert
  // the row (honeypot_tripped = true) so the founders can review/tune false
  // positives per the schema's own comment, but skip the upload work and
  // notification email, and return success so the bot gets no signal that
  // anything was rejected.
  let uploadedFilePaths: string[] | null = null;

  if (!honeypotTripped && file && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: "The uploaded file is too large (max 10MB)." };
    }
    if (!isAllowedUpload(file)) {
      return {
        ok: false,
        error:
          "Unsupported file type. Please upload a PDF, Excel (.xls/.xlsx), CSV, or image file.",
      };
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const storagePath = `${payload.pathway}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("enquiry-uploads")
      .upload(storagePath, file, {
        contentType: file.type || undefined,
        upsert: false,
      });

    if (uploadError) {
      console.error("[enquiries] File upload failed:", uploadError);
      return {
        ok: false,
        error:
          "We couldn't upload your file. Please try again, or use the structured line-item entry instead.",
      };
    }

    uploadedFilePaths = [storagePath];
  }

  const { error: insertError } = await supabase.from("enquiries").insert({
    ...payload,
    uploaded_file_paths: uploadedFilePaths,
    honeypot_tripped: honeypotTripped,
    status: "new",
    matched_company_id: null,
    project_id: null,
  });

  if (insertError) {
    // Expected in this repo until the Supabase migrations are applied to
    // the live project (per Task 8 brief) — surface a generic message to
    // the visitor and keep the details server-side only.
    console.error("[enquiries] Insert failed:", insertError);
    return {
      ok: false,
      error:
        "Something went wrong submitting your request. Please try again shortly, or email us directly if the problem continues.",
    };
  }

  if (!honeypotTripped) {
    const emailResult = await sendEnquiryNotification({
      pathway: payload.pathway,
      companyName: payload.company_name,
      contactName: payload.contact_name,
      contactEmail: payload.contact_email,
      contactPhone: payload.contact_phone,
      summaryLines: notification.summaryLines,
    });
    if (!emailResult.ok) {
      // Per Task 8 brief: email failure must NOT fail the submission.
      console.error(
        "[enquiries] Notification email failed (submission still succeeded):",
        emailResult.error
      );
    }
  }

  return { ok: true };
}

/** Reads the honeypot field off FormData. Exported so actions can attach it to the payload. */
export function readHoneypotTripped(formData: FormData): boolean {
  const value = formData.get(HONEYPOT_FIELD_NAME);
  return typeof value === "string" && value.trim().length > 0;
}

import "server-only";
import { Resend } from "resend";
import { enquiryNotificationRecipients, siteMeta } from "@/lib/site-content";

/**
 * Best-effort transactional email via Resend. Per Task 8 build plan
 * instruction: "Email failure must NOT fail the submission — log and
 * continue." Every function here therefore swallows its own errors and
 * returns a simple ok/error result rather than throwing, so callers can log
 * without ever letting an email problem block the enquiry from being saved.
 */

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export interface EnquiryNotificationInput {
  pathway: "new_construction" | "retrofit";
  companyName: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  summaryLines: Array<{ label: string; value: string }>;
}

/**
 * Sends a plain-text "new enquiry" notification to the founders. Never
 * throws — returns { ok: false, error } on any failure (missing API key,
 * network error, Resend API error) so the calling server action can log the
 * problem and still treat the enquiry submission itself as successful.
 */
export async function sendEnquiryNotification(
  input: EnquiryNotificationInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResendClient();
  if (!resend) {
    console.error(
      "[email] RESEND_API_KEY is not set — skipping enquiry notification email."
    );
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const pathwayLabel =
    input.pathway === "new_construction" ? "New Construction" : "Retrofit & Replacement";

  const lines = [
    `New ${pathwayLabel} enquiry submitted on ${siteMeta.siteUrl}.`,
    "",
    `Contact: ${input.contactName}`,
    `Email: ${input.contactEmail}`,
    input.contactPhone ? `Phone: ${input.contactPhone}` : null,
    input.companyName ? `Company: ${input.companyName}` : null,
    "",
    ...input.summaryLines.map((l) => `${l.label}: ${l.value}`),
    "",
    "View and convert this enquiry from the admin pipeline once it is live.",
  ].filter((l): l is string => l !== null);

  try {
    const { error } = await resend.emails.send({
      // TODO(founder input needed): swap for a verified @veridanlimited.com
      // sending address once the Resend sending domain is verified (see
      // build plan §5 Prerequisites — SPF/DKIM at GoDaddy). Resend's
      // sandbox "onboarding@resend.dev" only works in development/testing.
      from: "Veridan Website <onboarding@resend.dev>",
      to: [...enquiryNotificationRecipients],
      replyTo: input.contactEmail,
      subject: `New ${pathwayLabel} enquiry — ${input.companyName || input.contactName}`,
      text: lines.join("\n"),
    });

    if (error) {
      console.error("[email] Resend returned an error:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error sending email.";
    console.error("[email] Failed to send enquiry notification:", err);
    return { ok: false, error: message };
  }
}

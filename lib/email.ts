import "server-only";
import { Resend } from "resend";
import { enquiryNotificationRecipients, siteMeta } from "@/lib/site-content";
import { formatInvoiceJmd } from "@/lib/invoice-pdf/format";

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
      "[veridan:email] RESEND_API_KEY is not set — skipping enquiry notification email."
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
      // Domain verified in Resend 2026-07-16; sender confirmed by founders.
      from: "Veridan Website <quotes@veridanlimited.com>",
      to: [...enquiryNotificationRecipients],
      replyTo: input.contactEmail,
      subject: `New ${pathwayLabel} enquiry — ${input.companyName || input.contactName}`,
      text: lines.join("\n"),
    });

    if (error) {
      console.error("[veridan:email] Resend returned an error:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error sending email.";
    console.error("[veridan:email] Failed to send enquiry notification:", err);
    return { ok: false, error: message };
  }
}

export interface QuoteEmailInput {
  to: string;
  quoteRef: string;
  projectName: string;
  clientCompanyName: string | null;
  validUntilLabel: string;
  pdfBuffer: Buffer;
}

/**
 * Sends the client-facing quote email with the PDF attached (Task 19 send
 * flow, §6.4 "Send: emailed from the app via Resend; PDF attached"). Unlike
 * sendEnquiryNotification, this one does NOT swallow its own failure as a
 * best-effort side channel — a failed send is the build plan's explicit
 * "send fails cleanly (status stays approved, error surfaced)" requirement,
 * so the caller (workflowActions.ts sendQuote) must see the error and must
 * NOT advance the quote's status or write sent_at/sent_to when this returns
 * ok: false.
 */
export async function sendQuoteEmail(
  input: QuoteEmailInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResendClient();
  if (!resend) {
    return { ok: false, error: "RESEND_API_KEY is not configured — cannot send this quote." };
  }

  const clientLine = input.clientCompanyName ? ` for ${input.clientCompanyName}` : "";
  const text = [
    `Please find attached quote ${input.quoteRef}${clientLine} — ${input.projectName}.`,
    "",
    `This quote is valid until ${input.validUntilLabel}.`,
    "",
    "Please reach out with any questions.",
  ].join("\n");

  try {
    const { error } = await resend.emails.send({
      // Domain verified in Resend 2026-07-16; sender confirmed by founders.
      from: "Veridan Limited <quotes@veridanlimited.com>",
      replyTo: "quotes@veridanlimited.com",
      to: [input.to],
      subject: `Veridan quote ${input.quoteRef} — ${input.projectName}`,
      text,
      attachments: [
        {
          filename: `${input.quoteRef}.pdf`,
          content: input.pdfBuffer,
        },
      ],
    });

    if (error) {
      console.error("[veridan:email] Resend returned an error sending a quote:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error sending email.";
    console.error("[veridan:email] Failed to send quote email:", err);
    return { ok: false, error: message };
  }
}

export interface InvoiceEmailInput {
  to: string;
  invoiceNumber: string;
  projectName: string;
  amountJmd: number;
  dueNote: string | null;
  quoteRef: string | null;
  pdfBuffer: Buffer;
}

/**
 * Sends the client-facing invoice email with the PDF attached (Task 48c send
 * flow — mirrors sendQuoteEmail's contract exactly). Does NOT swallow its
 * own failure: a failed send must be surfaced to the caller
 * (app/admin/invoices/[id]/actions.ts sendInvoice) so the invoice's status
 * stays 'issued' and nothing beyond the harmless, overwrite-on-retry
 * Storage upload persists.
 */
export async function sendInvoiceEmail(
  input: InvoiceEmailInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = getResendClient();
  if (!resend) {
    return { ok: false, error: "RESEND_API_KEY is not configured — cannot send this invoice." };
  }

  const text = [
    `Please find attached invoice ${input.invoiceNumber} for ${input.projectName}.`,
    "",
    `Amount due: ${formatInvoiceJmd(input.amountJmd)}.`,
    input.dueNote ? input.dueNote : null,
    input.quoteRef ? `Reference quote: ${input.quoteRef}.` : null,
    "",
    "Please reach out with any questions.",
  ].filter((l): l is string => l !== null);

  try {
    const { error } = await resend.emails.send({
      // Domain verified in Resend 2026-07-16; sender confirmed by founders,
      // same address the quote send flow uses.
      from: "Veridan Limited <quotes@veridanlimited.com>",
      replyTo: "quotes@veridanlimited.com",
      to: [input.to],
      subject: `Veridan invoice ${input.invoiceNumber} — ${input.projectName}`,
      text: text.join("\n"),
      attachments: [
        {
          filename: `${input.invoiceNumber}.pdf`,
          content: input.pdfBuffer,
        },
      ],
    });

    if (error) {
      console.error("[veridan:email] Resend returned an error sending an invoice:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error sending email.";
    console.error("[veridan:email] Failed to send invoice email:", err);
    return { ok: false, error: message };
  }
}

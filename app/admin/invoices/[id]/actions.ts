"use server";

/**
 * Invoice actions (Task 49 UI, built alongside 44-47): issue (draft ->
 * issued), void (guarded against paid/partially_paid), and record payment
 * (updates status via the pure lib/invoices/paymentStatus.ts derivation).
 * Mirrors app/admin/quotes/[id]/workflowActions.ts's single-winner
 * conditional-update pattern for status transitions.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { sendInvoiceEmail } from "@/lib/email";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { uploadInvoicePdf } from "@/lib/storage";
import { formatJmd } from "@/lib/quotes/format";
import {
  computeRemainingBalanceJmd,
  nextInvoiceStatusAfterPayment,
  paymentExceedsRemainingBalance,
  sumPayments,
} from "@/lib/invoices/paymentStatus";
import type { InvoicePaymentRow, InvoiceRow } from "@/lib/supabase/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InvoiceActionResult = { ok: true; error?: undefined } | { ok: false; error: string };

function revalidateInvoice(invoiceId: string) {
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/invoices");
}

/** draft -> issued. Single-winner: only a still-draft row matches the update. */
export async function issueInvoice(invoiceId: string): Promise<InvoiceActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to issue an invoice." };

  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "issued", issued_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: `Could not issue the invoice: ${error.message}` };
  if (!data) return { ok: false, error: "Only a draft invoice can be issued (it may already be issued)." };

  revalidateInvoice(invoiceId);
  return { ok: true };
}

/**
 * Void — guarded so a paid or partially_paid invoice (real money already
 * recorded against it) can never be voided; draft/issued/sent can. Single-
 * winner via the same `.in(...)` + returned-row-check pattern quotes use.
 *
 * Task 49 extension: even for a status that WOULD otherwise be voidable
 * (issued/sent), block the void if any payment row already exists against
 * this invoice. In the normal flow a payment always flips status to
 * partially_paid/paid (already excluded above), but this is a defense-in-
 * depth check against any path that could leave a payment recorded while the
 * status hasn't (yet) been updated to reflect it.
 */
export async function voidInvoice(invoiceId: string): Promise<InvoiceActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to void an invoice." };

  const { data: existingPayments, error: paymentsCheckError } = await supabase
    .from("invoice_payments")
    .select("id")
    .eq("invoice_id", invoiceId)
    .limit(1);
  if (paymentsCheckError) {
    return { ok: false, error: `Could not verify payment history: ${paymentsCheckError.message}` };
  }
  if ((existingPayments ?? []).length > 0) {
    return {
      ok: false,
      error: "This invoice cannot be voided — at least one payment has already been recorded against it.",
    };
  }

  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "void" })
    .eq("id", invoiceId)
    .in("status", ["draft", "issued", "sent"])
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: `Could not void the invoice: ${error.message}` };
  if (!data) {
    return {
      ok: false,
      error: "This invoice cannot be voided — it may already be paid, partially paid, or void.",
    };
  }

  revalidateInvoice(invoiceId);
  return { ok: true };
}

/**
 * Records a payment and re-derives the invoice's status from the running
 * total of all its payments (lib/invoices/paymentStatus.ts). Only invoices
 * that are issued/sent/partially_paid accept payments — draft (not yet a
 * real bill) and paid/void (nothing left to record) are rejected up front.
 */
export async function recordPayment(
  invoiceId: string,
  _prevState: InvoiceActionResult,
  formData: FormData,
): Promise<InvoiceActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to record a payment." };

  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError) return { ok: false, error: `Could not load the invoice: ${invoiceError.message}` };
  const invoice = invoiceData as InvoiceRow | null;
  if (!invoice) return { ok: false, error: "Invoice not found." };

  if (!["issued", "sent", "partially_paid"].includes(invoice.status)) {
    return {
      ok: false,
      error: `A payment cannot be recorded against a ${invoice.status} invoice.`,
    };
  }

  const amountJmd = Number(formData.get("amount_jmd"));
  if (!Number.isFinite(amountJmd) || amountJmd <= 0) {
    return { ok: false, error: "Enter a payment amount greater than zero." };
  }
  const paidAt = String(formData.get("paid_at") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const method = String(formData.get("method") ?? "").trim() || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  // Task 49: reject a payment that would exceed the remaining balance,
  // computed from payments recorded BEFORE this one (never including the
  // amount being validated).
  const { data: existingPaymentsData, error: existingPaymentsError } = await supabase
    .from("invoice_payments")
    .select("amount_jmd")
    .eq("invoice_id", invoiceId);
  if (existingPaymentsError) {
    return { ok: false, error: `Could not check existing payments: ${existingPaymentsError.message}` };
  }
  const totalPaidSoFar = sumPayments(((existingPaymentsData as InvoicePaymentRow[]) ?? []).map((p) => p.amount_jmd));
  const remaining = computeRemainingBalanceJmd(invoice.amount_jmd, totalPaidSoFar);
  if (paymentExceedsRemainingBalance(amountJmd, remaining)) {
    return {
      ok: false,
      error: `This payment (${formatJmd(amountJmd, 2)}) exceeds the remaining balance of ${formatJmd(remaining, 2)}.`,
    };
  }

  const { error: insertError } = await supabase.from("invoice_payments").insert({
    invoice_id: invoiceId,
    amount_jmd: amountJmd,
    paid_at: paidAt,
    method,
    reference,
    notes,
    recorded_by: user.id,
  });
  if (insertError) return { ok: false, error: `Could not record the payment: ${insertError.message}` };

  const { data: paymentsData, error: paymentsError } = await supabase
    .from("invoice_payments")
    .select("amount_jmd")
    .eq("invoice_id", invoiceId);
  if (paymentsError) {
    return {
      ok: false,
      error: `Payment recorded, but the invoice's status could not be refreshed: ${paymentsError.message}. Refresh to see the payment.`,
    };
  }
  const totalPaid = sumPayments(((paymentsData as InvoicePaymentRow[]) ?? []).map((p) => p.amount_jmd));
  const nextStatus = nextInvoiceStatusAfterPayment(invoice.amount_jmd, totalPaid);

  const { error: statusError } = await supabase
    .from("invoices")
    .update({ status: nextStatus })
    .eq("id", invoiceId);
  if (statusError) {
    return {
      ok: false,
      error: `Payment recorded, but the invoice's status could not be updated: ${statusError.message}. Refresh and check.`,
    };
  }

  revalidateInvoice(invoiceId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Send (Task 48c) — mirrors app/admin/quotes/[id]/workflowActions.ts sendQuote
// exactly: render PDF -> upload artifact -> email -> record. Email failure
// never advances status past 'issued'.
// ---------------------------------------------------------------------------

/**
 * Send flow: (1) render the PDF via the SAME function the download route
 * uses, (2) upload it to `invoice-pdfs` as the immutable sent artifact, (3)
 * email the chosen recipient via Resend with the PDF attached, (4) record
 * sent_at/sent_to + the artifact path and flip status -> 'sent'. Only an
 * 'issued' invoice can be sent; the final status update is conditional on
 * the row still being 'issued' (single-winner — a double-click or a retried
 * request after a network blip can send the email twice at worst, but can
 * never both "win" the status transition).
 */
export async function sendInvoice(
  invoiceId: string,
  _prevState: InvoiceActionResult,
  formData: FormData,
): Promise<InvoiceActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to send an invoice." };

  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .select("*, quotes(id, quote_ref), projects(id, name)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError) return { ok: false, error: `Could not load the invoice: ${invoiceError.message}` };
  const invoice = invoiceData as
    | (InvoiceRow & { quotes: { id: string; quote_ref: string } | null; projects: { id: string; name: string } | null })
    | null;
  if (!invoice) return { ok: false, error: "Invoice not found." };

  if (invoice.status !== "issued") {
    return { ok: false, error: "Only an issued invoice can be sent (it may already be sent)." };
  }

  const recipient = String(formData.get("recipient_email") ?? "").trim();
  if (!recipient || !EMAIL_RE.test(recipient)) {
    return { ok: false, error: "Enter a valid recipient email address." };
  }

  // 1. Render the PDF — same function the "Download PDF" link uses.
  const pdfResult = await renderInvoicePdf(supabase, invoiceId);
  if (!pdfResult.ok) return { ok: false, error: `Could not render the invoice PDF: ${pdfResult.error}` };

  // 2. Upload the immutable sent artifact.
  const upload = await uploadInvoicePdf(supabase, invoice.invoice_number, pdfResult.buffer);
  if (upload.error || !upload.path) {
    return { ok: false, error: `Could not save the invoice's PDF artifact: ${upload.error ?? "unknown error"}` };
  }

  // 3. Email it. Failure here must NOT advance the status.
  const emailResult = await sendInvoiceEmail({
    to: recipient,
    invoiceNumber: invoice.invoice_number,
    projectName: invoice.projects?.name ?? "your project",
    amountJmd: invoice.amount_jmd,
    dueNote: invoice.due_note,
    quoteRef: invoice.quotes?.quote_ref ?? null,
    pdfBuffer: pdfResult.buffer,
  });
  if (!emailResult.ok) {
    return { ok: false, error: `The invoice could not be emailed: ${emailResult.error}. Nothing was sent — try again.` };
  }

  // 4. Record the send — single-winner: only an invoice still 'issued' matches.
  const { data: won, error: updateError } = await supabase
    .from("invoices")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_to: recipient,
      pdf_storage_path: upload.path,
    })
    .eq("id", invoiceId)
    .eq("status", "issued")
    .select("id")
    .maybeSingle();
  if (updateError) {
    return {
      ok: false,
      error: `The invoice was emailed, but its status could not be updated: ${updateError.message}. Refresh and check before sending again.`,
    };
  }
  if (!won) {
    return {
      ok: false,
      error:
        "The invoice was emailed, but it had already moved past 'issued' by the time the status update ran (refresh to see the current state).",
    };
  }

  revalidateInvoice(invoiceId);
  return { ok: true };
}

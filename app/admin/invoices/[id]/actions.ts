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
import { generateBalanceInvoiceForQuote, generateDepositInvoiceForQuote } from "@/lib/invoices/generate";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { uploadInvoicePdf } from "@/lib/storage";
import { formatJmd } from "@/lib/quotes/format";
import { loadConfiguredPaymentInstructions } from "@/lib/invoices/paymentInstructions";
import {
  computeRemainingBalanceJmd,
  paymentExceedsRemainingBalance,
  sumPayments,
} from "@/lib/invoices/paymentStatus";
import type { InvoicePaymentRow, InvoiceRow } from "@/lib/supabase/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Custom SQLSTATEs raised by record_invoice_payment() — see
// supabase/migrations/20260718000003_invoice_payment_guard.sql's header for
// the full rationale. Matched on error.code (MINOR-6-style: code first,
// message text only as a human-readable fallback), never string-matched
// against error.message.
const RPC_ERRCODE_OVERPAYMENT = "J0001";
const RPC_ERRCODE_INVALID_STATUS = "J0002";
const RPC_ERRCODE_NOT_FOUND = "J0003";

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
 * Records a payment via the record_invoice_payment() RPC (MAJOR-1 fix —
 * supabase/migrations/20260718000003_invoice_payment_guard.sql), which locks
 * the invoice row, re-sums payments, refuses an overpayment, inserts the
 * payment, and re-derives the invoice's status (mirroring
 * lib/invoices/paymentStatus.ts's nextInvoiceStatusAfterPayment) — all in one
 * transaction. That RPC is the ENFORCEMENT. The status/amount checks below,
 * before the RPC call, are a FAST-PATH UX validation only: they give an
 * immediate, cheap error for the common case, but two concurrent submissions
 * could both pass them against the same pre-insert reads, which is exactly
 * why the actual guard lives in the RPC's locked transaction instead.
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

  // Fast-path UX validation ONLY (see this function's header) — computed
  // from payments recorded BEFORE this one, never including the amount being
  // validated.
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

  // Enforcement: record_invoice_payment() locks the invoice row, re-checks
  // the same condition atomically against the CURRENT payment total, then
  // inserts the payment and updates the invoice's status in the same
  // transaction — closing the race the fast-path check above cannot close by
  // itself. See supabase/migrations/20260718000003_invoice_payment_guard.sql.
  const { error: rpcError } = await supabase.rpc("record_invoice_payment", {
    p_invoice_id: invoiceId,
    p_amount_jmd: amountJmd,
    p_paid_at: paidAt,
    p_method: method,
    p_reference: reference,
    p_notes: notes,
    p_recorded_by: user.id,
  });

  if (rpcError) {
    if (rpcError.code === RPC_ERRCODE_OVERPAYMENT) {
      return {
        ok: false,
        error: `This payment (${formatJmd(amountJmd, 2)}) would exceed the invoice's remaining balance — another payment may have just been recorded. Refresh and try again.`,
      };
    }
    if (rpcError.code === RPC_ERRCODE_INVALID_STATUS) {
      return {
        ok: false,
        error: `A payment cannot be recorded against this invoice right now (its status may have just changed). Refresh and check.`,
      };
    }
    if (rpcError.code === RPC_ERRCODE_NOT_FOUND) {
      return { ok: false, error: "Invoice not found." };
    }
    return { ok: false, error: `Could not record the payment: ${rpcError.message}` };
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

  // MAJOR-3 fix (parameter-backed since 2026-07-19): refuse to send while
  // the admin-editable "invoice_payment_instructions" parameter still
  // carries TODO placeholder bank details — a real client must never
  // receive a made-up account number. The invoice detail page shows an
  // amber warning banner for the same reason before a founder even reaches
  // for this button.
  const { configured } = await loadConfiguredPaymentInstructions(supabase);
  if (!configured) {
    return {
      ok: false,
      error:
        "Fill in the real bank details first: Admin → Parameters → \"invoice_payment_instructions\" (replace every TODO field). Sending unlocks automatically once saved.",
    };
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

// ---------------------------------------------------------------------------
// Regenerate (MINOR-5 fix) — a voided invoice is otherwise a dead end.
// ---------------------------------------------------------------------------

/** Regenerate's result additionally carries the new invoice's id so the caller can link to it (spec: "Link the new invoice from the result"). */
export type RegenerateInvoiceResult =
  | { ok: true; newInvoiceId: string; error?: undefined }
  | { ok: false; error: string; newInvoiceId?: undefined };

/**
 * Regenerates a fresh invoice for the SAME quote + invoice_type as a void
 * invoice, only ever offered from a void invoice's own detail page (see
 * InvoiceActionsPanel — the button is hidden unless status='void'). Reuses
 * the exact generator functions the accept/mark-customs-cleared workflow
 * actions already call (generateDepositInvoiceForQuote /
 * generateBalanceInvoiceForQuote), so this creates no second code path for
 * "what an invoice looks like" — same amounts.ts fidelity, same numbering,
 * same idempotency. uq_invoices_quote_type_active (WHERE status != 'void')
 * already permits a new non-void invoice to exist alongside any number of
 * void ones for the same (quote_id, invoice_type), so no schema change was
 * needed; the generators' own `alreadyExisted` idempotency covers the edge
 * case where a non-void invoice of that type already exists by the time this
 * runs (e.g. a second regenerate click).
 *
 * Guarded so this can never conjure an invoice for a quote in a state that
 * wouldn't otherwise generate one: the quote must still be 'accepted'
 * (deposit and balance both require it), and a balance regeneration
 * additionally requires customs_cleared_at to be set (mirrors
 * markCustomsCleared's own precondition in
 * app/admin/quotes/[id]/workflowActions.ts). Does NOT redirect — the caller
 * (InvoiceActionsPanel) renders a link to the new invoice from the returned
 * id, staying on the void invoice's own page.
 */
export async function regenerateInvoice(invoiceId: string): Promise<RegenerateInvoiceResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to regenerate an invoice." };

  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_type, status, quote_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError) return { ok: false, error: `Could not load the invoice: ${invoiceError.message}` };
  const invoice = invoiceData as Pick<InvoiceRow, "id" | "invoice_type" | "status" | "quote_id"> | null;
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status !== "void") {
    return { ok: false, error: "Only a void invoice can be regenerated." };
  }

  const { data: quoteData, error: quoteError } = await supabase
    .from("quotes")
    .select("id, status, customs_cleared_at")
    .eq("id", invoice.quote_id)
    .maybeSingle();
  if (quoteError) return { ok: false, error: `Could not load the source quote: ${quoteError.message}` };
  const quote = quoteData as { id: string; status: string; customs_cleared_at: string | null } | null;
  if (!quote) return { ok: false, error: "The source quote for this invoice no longer exists." };

  if (quote.status !== "accepted") {
    return {
      ok: false,
      error: "This invoice's quote is no longer in an accepted state — a new invoice cannot be regenerated for it.",
    };
  }
  if (invoice.invoice_type === "balance" && !quote.customs_cleared_at) {
    return {
      ok: false,
      error:
        "This quote has not been marked customs cleared — a balance invoice cannot be regenerated until it is.",
    };
  }

  const invoiceResult =
    invoice.invoice_type === "deposit"
      ? await generateDepositInvoiceForQuote(supabase, quote.id, user.id)
      : await generateBalanceInvoiceForQuote(supabase, quote.id, user.id);

  if (!invoiceResult.ok) {
    return { ok: false, error: `Could not regenerate the invoice: ${invoiceResult.error}` };
  }

  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
  return { ok: true, newInvoiceId: invoiceResult.invoice.id };
}

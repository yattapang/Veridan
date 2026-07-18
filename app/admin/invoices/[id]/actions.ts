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
import { nextInvoiceStatusAfterPayment, sumPayments } from "@/lib/invoices/paymentStatus";
import type { InvoicePaymentRow, InvoiceRow } from "@/lib/supabase/types";

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

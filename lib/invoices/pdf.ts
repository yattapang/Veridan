/**
 * Invoice PDF data loading + rendering (Task 48b). Mirrors lib/quotes/pdf.ts
 * exactly: one function turns an invoice id into a PDF buffer, used by BOTH
 * the download route (app/api/invoices/[id]/pdf/route.ts) and the send flow
 * (app/admin/invoices/[id]/actions.ts sendInvoice) so there is exactly one
 * place that renders an invoice document.
 *
 * Every figure rendered comes straight off the invoices row (subtotal_jmd,
 * gct_amount_jmd, amount_jmd, amount_usd, fx_note, due_note) — this file
 * never recomputes an amount; see lib/invoices/amounts.ts's header for the
 * fidelity argument those numbers already satisfy.
 */

import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDepositContextLine } from "@/lib/invoice-pdf/format";
import { InvoicePdf } from "@/lib/invoice-pdf/InvoicePdf";
import { invoicePaymentInstructions, siteMeta, contactInfo } from "@/lib/site-content";
import type { InvoiceRow, ParametersSnapshotStored } from "@/lib/supabase/types";

type Client = SupabaseClient;

export type InvoicePdfLoadResult =
  | { ok: true; invoiceNumber: string; buffer: Buffer; error?: undefined }
  | { ok: false; status: number; error: string };

interface InvoiceForPdf extends InvoiceRow {
  quotes: { id: string; quote_ref: string; deposit_pct: number; parameters_snapshot: ParametersSnapshotStored } | null;
  projects: { id: string; name: string } | null;
  companies: { id: string; name: string } | null;
}

/**
 * Loads an invoice's full display state (+ its source quote, for the
 * deposit_pct context line and the frozen company_details footer) and
 * renders the branded invoice PDF to a buffer.
 */
export async function renderInvoicePdf(supabase: Client, invoiceId: string): Promise<InvoicePdfLoadResult> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*, quotes(id, quote_ref, deposit_pct, parameters_snapshot), projects(id, name), companies(id, name)")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: "Invoice not found." };

  const invoice = data as unknown as InvoiceForPdf;

  const snapshotCompany = invoice.quotes?.parameters_snapshot?.company_details ?? {};
  const company = {
    name: snapshotCompany.name?.trim() || siteMeta.legalName,
    address: snapshotCompany.address?.trim() || "",
    trn: snapshotCompany.trn?.trim() || "",
    phone: snapshotCompany.phone?.trim() || "",
    email: snapshotCompany.email?.trim() || contactInfo.email,
  };

  const depositContextLine = buildDepositContextLine(
    invoice.invoice_type,
    invoice.quotes?.quote_ref ?? null,
    invoice.quotes?.deposit_pct ?? null,
  );

  const pdfDoc = InvoicePdf({
    wordmark: siteMeta.wordmark,
    invoiceNumber: invoice.invoice_number,
    invoiceType: invoice.invoice_type,
    status: invoice.status,
    issueDateIso: invoice.issued_at,
    quoteRef: invoice.quotes?.quote_ref ?? null,
    depositPct: invoice.quotes?.deposit_pct ?? null,
    project: {
      name: invoice.projects?.name ?? "—",
      clientCompanyName: invoice.companies?.name ?? null,
    },
    subtotalJmd: invoice.subtotal_jmd,
    gctAmountJmd: invoice.gct_amount_jmd,
    amountJmd: invoice.amount_jmd,
    amountUsd: invoice.amount_usd,
    fxNote: invoice.fx_note,
    depositContextLine,
    dueNote: invoice.due_note,
    company,
    bankDetails: invoicePaymentInstructions,
  });

  const buffer = await renderToBuffer(pdfDoc);
  return { ok: true, invoiceNumber: invoice.invoice_number, buffer };
}

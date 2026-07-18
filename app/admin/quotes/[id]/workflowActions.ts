"use server";

/**
 * Quote workflow state transitions (Task 19): approve, send (Resend + PDF
 * attach + Storage artifact), accept/decline, manual expire, and the
 * revision flow. Every mutation here is guarded by lib/quotes/workflow.ts's
 * pure `canTransition`/`canEdit` — this file is intentionally thin I/O glue
 * around those rules, not a second place business logic could drift.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { sendQuoteEmail } from "@/lib/email";
import { uploadQuotePdf } from "@/lib/storage";
import { renderQuotePdf } from "@/lib/quotes/pdf";
import { formatValidUntil } from "@/lib/quote-pdf/format";
import { buildFxSnapshot, buildParametersSnapshot } from "@/lib/quotes/snapshot";
import { loadQuoteState, recomputeQuote } from "@/lib/quotes/persist";
import { canEdit, canTransition, nextRevisionNumber, revisionQuoteRef } from "@/lib/quotes/workflow";
import { generateBalanceInvoiceForQuote, generateDepositInvoiceForQuote } from "@/lib/invoices/generate";
import type { BusinessParameterRow, QuoteOriginRow, QuoteRow, QuoteStatus } from "@/lib/supabase/types";

export type WorkflowActionResult = { ok: true; error?: undefined } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Loads just the quote fields every workflow action needs to guard + act on. */
async function loadQuoteForWorkflow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quoteId: string,
): Promise<{ quote: QuoteRow & { projects: { id: string; name: string; companies: { id: string; name: string } | null } | null } } | { error: string }> {
  const { data, error } = await supabase
    .from("quotes")
    // Disambiguated: projects has two FKs into companies (company_id and
    // architect_company_id) — PostgREST needs the explicit !constraint hint.
    .select("*, projects(id, name, companies!projects_company_id_fkey(id, name))")
    .eq("id", quoteId)
    .maybeSingle();
  if (error) return { error: `Could not load the quote: ${error.message}` };
  if (!data) return { error: "Quote not found." };
  return { quote: data as unknown as QuoteRow & { projects: { id: string; name: string; companies: { id: string; name: string } | null } | null } };
}

function revalidateQuote(quoteId: string, projectId?: string) {
  revalidatePath(`/admin/quotes/${quoteId}`);
  revalidatePath("/admin/quotes");
  if (projectId) revalidatePath(`/admin/projects/${projectId}`);
}

/** Applies a plain status transition (no side effects beyond the status + its timestamp column). */
async function applySimpleTransition(
  quoteId: string,
  to: QuoteStatus,
  extraColumns: Record<string, unknown> = {},
): Promise<WorkflowActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to change a quote's status." };

  const loaded = await loadQuoteForWorkflow(supabase, quoteId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { quote } = loaded;

  const guard = canTransition(quote.status, to);
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await supabase
    .from("quotes")
    .update({ status: to, ...extraColumns })
    .eq("id", quoteId);
  if (error) return { ok: false, error: `Could not update the quote: ${error.message}` };

  revalidateQuote(quoteId, quote.projects?.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Approve (§6.4 — either founder may approve)
// ---------------------------------------------------------------------------

export async function approveQuote(quoteId: string): Promise<WorkflowActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to approve a quote." };

  const loaded = await loadQuoteForWorkflow(supabase, quoteId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { quote } = loaded;

  const guard = canTransition(quote.status, "approved");
  if (!guard.ok) return { ok: false, error: guard.error };

  const { error } = await supabase
    .from("quotes")
    .update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() })
    .eq("id", quoteId);
  if (error) return { ok: false, error: `Could not approve the quote: ${error.message}` };

  revalidateQuote(quoteId, quote.projects?.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Send (§6.4 — Resend, PDF attached, Storage artifact, sent_at/sent_to)
// ---------------------------------------------------------------------------

/**
 * Send flow (draft plan order): (1) render the PDF buffer via the SAME
 * function the download link uses, (2) upload it to `quote-pdfs` as the
 * immutable sent artifact, (3) email the chosen recipient via Resend with
 * the PDF attached, (4) record sent_at/sent_to + the artifact path. An email
 * failure returns an error and leaves the quote's status at 'approved' —
 * nothing beyond the (harmless, overwrite-on-retry) storage upload persists.
 */
export async function sendQuote(
  quoteId: string,
  _prevState: WorkflowActionResult,
  formData: FormData,
): Promise<WorkflowActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to send a quote." };

  const loaded = await loadQuoteForWorkflow(supabase, quoteId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { quote } = loaded;

  const guard = canTransition(quote.status, "sent");
  if (!guard.ok) return { ok: false, error: guard.error };

  const recipient = String(formData.get("recipient_email") ?? "").trim();
  if (!recipient || !EMAIL_RE.test(recipient)) {
    return { ok: false, error: "Enter a valid recipient email address." };
  }

  // 1. Render the PDF — same function the "Download PDF" link uses.
  const pdfResult = await renderQuotePdf(supabase, quoteId);
  if (!pdfResult.ok) return { ok: false, error: `Could not render the quote PDF: ${pdfResult.error}` };

  // 2. Upload the immutable sent artifact.
  const upload = await uploadQuotePdf(supabase, quote.quote_ref, quote.revision_number, pdfResult.buffer);
  if (upload.error || !upload.path) {
    return { ok: false, error: `Could not save the quote's PDF artifact: ${upload.error ?? "unknown error"}` };
  }

  // 3. Email it. Failure here must NOT advance the status.
  const validUntilLabel = formatValidUntil(quote.quote_date, quote.validity_days);
  const emailResult = await sendQuoteEmail({
    to: recipient,
    quoteRef: quote.quote_ref,
    projectName: quote.projects?.name ?? "your project",
    clientCompanyName: quote.projects?.companies?.name ?? null,
    validUntilLabel,
    pdfBuffer: pdfResult.buffer,
  });
  if (!emailResult.ok) {
    return { ok: false, error: `The quote could not be emailed: ${emailResult.error}. Nothing was sent — try again.` };
  }

  // 4. Record the send.
  const { error: updateError } = await supabase
    .from("quotes")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_to: recipient,
      pdf_storage_path: upload.path,
    })
    .eq("id", quoteId);
  if (updateError) {
    return {
      ok: false,
      error: `The quote was emailed, but its status could not be updated: ${updateError.message}. Refresh and check before sending again.`,
    };
  }

  revalidateQuote(quoteId, quote.projects?.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Accept / decline / manual expire
// ---------------------------------------------------------------------------

/**
 * Accept (§6.4) + deposit invoice auto-generation (Task 46, PRD §9.3). The
 * accept transition is single-winner via applySimpleTransition's
 * canTransition guard and commits first; invoice generation runs only after
 * that succeeds and its failure is reported as a SEPARATE problem on top of
 * an already-successful accept — it must never look like (or actually be) a
 * rollback of the accept itself.
 */
export async function acceptQuote(quoteId: string): Promise<WorkflowActionResult> {
  const transition = await applySimpleTransition(quoteId, "accepted", { accepted_at: new Date().toISOString() });
  if (!transition.ok) return transition;

  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return {
      ok: false,
      error: `Quote accepted; deposit invoice creation failed: ${
        err instanceof Error ? err.message : "Supabase is not configured."
      }`,
    };
  }
  const user = await getCurrentUser();

  const invoiceResult = await generateDepositInvoiceForQuote(supabase, quoteId, user?.id ?? null);
  if (!invoiceResult.ok) {
    return { ok: false, error: `Quote accepted; deposit invoice creation failed: ${invoiceResult.error}` };
  }

  revalidatePath("/admin/invoices");
  return { ok: true };
}

export async function declineQuote(quoteId: string): Promise<WorkflowActionResult> {
  return applySimpleTransition(quoteId, "declined", { declined_at: new Date().toISOString() });
}

/**
 * Manual "mark expired" (Task 19: "sent→expired (manual action + auto-flag:
 * computed 'expired' badge…)"). The computed badge (lib/quotes/workflow.ts
 * isComputedExpired) covers display without touching the row; this action is
 * for a founder who wants the STATUS itself to reflect it (e.g. closing out
 * the pipeline view) rather than leaving it silently flagged forever.
 */
export async function markQuoteExpired(quoteId: string): Promise<WorkflowActionResult> {
  return applySimpleTransition(quoteId, "expired");
}

// ---------------------------------------------------------------------------
// Mark customs cleared -> balance invoice generation (Task 47)
// ---------------------------------------------------------------------------

/**
 * Founder-triggered "Mark customs cleared" (Phase2_Plan §8 Q6 RESOLUTION):
 * the manual event that generates the balance invoice. Single-winner via a
 * conditional UPDATE (only accepted + not-already-cleared quotes match), so
 * a double-click can never stamp the event twice or generate two balance
 * invoices — mirrors the same pattern applySimpleTransition uses for status,
 * applied here to a plain timestamp column instead of the status enum.
 * Balance invoice generation runs only after the stamp commits and, like
 * acceptQuote, a generation failure is reported as a separate problem on top
 * of an already-committed "customs cleared" fact rather than undone.
 */
export async function markCustomsCleared(quoteId: string): Promise<WorkflowActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to mark customs cleared." };

  const loaded = await loadQuoteForWorkflow(supabase, quoteId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { quote } = loaded;

  if (quote.status !== "accepted") {
    return { ok: false, error: "Only an accepted quote can be marked customs cleared." };
  }
  if (quote.customs_cleared_at) {
    return { ok: false, error: "Customs was already marked cleared for this quote." };
  }

  const { data: won, error: updateError } = await supabase
    .from("quotes")
    .update({ customs_cleared_at: new Date().toISOString(), customs_cleared_by: user.id })
    .eq("id", quoteId)
    .eq("status", "accepted")
    .is("customs_cleared_at", null)
    .select("id")
    .maybeSingle();

  if (updateError) return { ok: false, error: `Could not mark customs cleared: ${updateError.message}` };
  if (!won) {
    return {
      ok: false,
      error: "Customs was already marked cleared for this quote (refresh to see the balance invoice).",
    };
  }

  revalidateQuote(quoteId, quote.projects?.id);

  const invoiceResult = await generateBalanceInvoiceForQuote(supabase, quoteId, user.id);
  if (!invoiceResult.ok) {
    return { ok: false, error: `Customs marked cleared; balance invoice creation failed: ${invoiceResult.error}` };
  }

  revalidatePath("/admin/invoices");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Revision flow (§6.4 — revisions are new versions, never overwrites)
// ---------------------------------------------------------------------------

/**
 * Duplicates a non-draft quote + its origins + lines into a NEW draft with
 * revision_number + 1 and parent_quote_id set to the quote being revised.
 * The original quote row (and every prior revision before it) is left
 * completely untouched. Default behaviour keeps the original parameter/FX
 * snapshot (revisions usually re-negotiate scope, not rates) — pass
 * `refresh_rates=on` to re-snapshot from the CURRENT business_parameters
 * instead. Line unit_cost/qty/currency are copied as-is; recomputeQuote
 * re-derives every USD/JMD cache from whichever fx_snapshot the new draft
 * ends up with, so a refreshed-rates revision's numbers are correct without
 * any manual FX math here.
 */
export async function createRevision(
  quoteId: string,
  _prevState: WorkflowActionResult,
  formData: FormData,
): Promise<WorkflowActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create a revision." };

  const { state, error: loadError } = await loadQuoteState(supabase, quoteId);
  if (loadError) return { ok: false, error: loadError };
  if (!state) return { ok: false, error: "Quote not found." };
  const { quote, origins, lines } = state;

  if (canEdit(quote.status)) {
    return { ok: false, error: "This quote is still a draft — edit it directly instead of creating a revision." };
  }

  const refreshRates = formData.get("refresh_rates") === "on";
  const newRevisionNumber = nextRevisionNumber(quote.revision_number);
  const newRef = revisionQuoteRef(quote.quote_ref, newRevisionNumber);

  let quoteDate = quote.quote_date;
  let validityDays = quote.validity_days;
  let parametersSnapshot = quote.parameters_snapshot;
  let fxSnapshot = quote.fx_snapshot;

  if (refreshRates) {
    const { data: paramRows, error: paramError } = await supabase.from("business_parameters").select("*");
    if (paramError) return { ok: false, error: `Could not load current parameters: ${paramError.message}` };
    const parameters = (paramRows as BusinessParameterRow[]) ?? [];
    quoteDate = new Date().toISOString().slice(0, 10);
    parametersSnapshot = buildParametersSnapshot(parameters);
    fxSnapshot = buildFxSnapshot(parameters, quoteDate);
    validityDays = parametersSnapshot.quote_validity_days;
  }

  // 1. Insert the new draft quote row.
  const { data: insertedQuote, error: quoteInsertError } = await supabase
    .from("quotes")
    .insert({
      project_id: quote.project_id,
      quote_ref: newRef,
      revision_number: newRevisionNumber,
      parent_quote_id: quote.id,
      status: "draft",
      quote_mode: quote.quote_mode,
      quote_date: quoteDate,
      validity_days: validityDays,
      architect_company_id: quote.architect_company_id,
      deposit_pct: quote.deposit_pct,
      margin_pct: quote.margin_pct,
      parameters_snapshot: parametersSnapshot,
      fx_snapshot: fxSnapshot,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (quoteInsertError || !insertedQuote) {
    return { ok: false, error: `Could not create the revision: ${quoteInsertError?.message ?? "unknown error"}` };
  }
  const newQuoteId = insertedQuote.id as string;

  // 2. Clone the origin cost pools, keyed by origin_label so lines can be re-pointed.
  const originIdByLabel = new Map<string, string>();
  if (origins.length > 0) {
    const { data: insertedOrigins, error: originInsertError } = await supabase
      .from("quote_origins")
      .insert(
        origins.map((o) => ({
          quote_id: newQuoteId,
          origin_label: o.origin_label,
          freight_export_fees_usd: o.freight_export_fees_usd,
          ocean_freight_usd: o.ocean_freight_usd,
          marine_insurance_usd: o.marine_insurance_usd,
          port_handling_usd: o.port_handling_usd,
          brokerage_usd: o.brokerage_usd,
          pallet_count: o.pallet_count,
          duty_gct_pct: o.duty_gct_pct,
        })),
      )
      .select("id, origin_label");
    if (originInsertError) {
      return {
        ok: false,
        error: `Revision ${newRef} was created but its shipment origins failed: ${originInsertError.message}. Delete it and try again.`,
      };
    }
    for (const o of (insertedOrigins as Array<{ id: string; origin_label: string }>) ?? []) {
      originIdByLabel.set(o.origin_label, o.id);
    }
  }
  const oldOriginLabelById = new Map<string, string>(
    (origins as QuoteOriginRow[]).map((o) => [o.id, o.origin_label]),
  );

  // 3. Clone the lines, re-pointed at the new origin pools.
  if (lines.length > 0) {
    const { error: lineInsertError } = await supabase.from("quote_line_items").insert(
      lines.map((l) => {
        const label = oldOriginLabelById.get(l.quote_origin_id);
        const newOriginId = (label && originIdByLabel.get(label)) ?? null;
        return {
          quote_id: newQuoteId,
          door_id: l.door_id,
          hardware_set_id: l.hardware_set_id,
          product_id: l.product_id,
          supplier_id: l.supplier_id,
          quote_origin_id: newOriginId,
          description_override: l.description_override,
          qty: l.qty,
          unit_cost: l.unit_cost,
          cost_currency: l.cost_currency,
          unit_cost_usd: l.unit_cost_usd, // placeholder; recompute below overwrites it
          line_value_usd: l.line_value_usd, // placeholder
          landed_cost_usd: l.landed_cost_usd, // placeholder
          margin_pct_override: l.margin_pct_override,
          sort_order: l.sort_order,
        };
      }),
    );
    if (lineInsertError) {
      return {
        ok: false,
        error: `Revision ${newRef} was created but its lines failed: ${lineInsertError.message}. Delete it and try again.`,
      };
    }
  }

  // 4. Recompute + persist caches for the new draft (also applies refreshed FX, if any).
  const { error: computeError } = await recomputeQuote(supabase, newQuoteId);
  if (computeError) {
    return {
      ok: false,
      error: `Revision ${newRef} was created but the initial calculation failed: ${computeError}. Open it and re-save to recompute.`,
    };
  }

  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/quotes/${quoteId}`);
  revalidatePath(`/admin/projects/${quote.project_id}`);
  redirect(`/admin/quotes/${newQuoteId}`);
}

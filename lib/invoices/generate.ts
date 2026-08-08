/**
 * Invoice generation — server-side I/O glue (Tasks 46/47). Not a "use
 * server" file itself (mirrors lib/quotes/persist.ts): it takes a Supabase
 * client as a parameter so it stays reusable from any server action, and
 * "use server" files may only export async functions per this repo's
 * convention, which would preclude the small pure helpers below living
 * alongside the I/O ones.
 *
 * Both generators are read-quote -> compute (lib/invoices/amounts.ts) ->
 * rpc for the next number -> insert. Idempotency is enforced by the DB
 * (uq_invoices_quote_type_active, supabase/migrations/20260718000002_invoicing.sql)
 * rather than a JS-side existence check, so a concurrent double-call can
 * never create two invoices of the same type for the same quote — the loser
 * gets a friendly "already exists" result instead of an error.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceLineItemRow, InvoiceRow, ParametersSnapshotStored, QuoteRow } from "@/lib/supabase/types";
import { computeBalanceInvoiceAmounts, computeDepositInvoiceAmounts, computeStandaloneInvoiceAmounts } from "./amounts";
import { computeLineItemTotals, type InvoiceLineItemDraft } from "./lineItems";
import { formatInvoiceNumber, jamaicaYear } from "./numbering";

type Client = SupabaseClient;

export type GenerateInvoiceResult =
  | { ok: true; invoice: InvoiceRow; alreadyExisted: false }
  | { ok: true; invoice: InvoiceRow; alreadyExisted: true }
  | { ok: false; error: string };

const UNIQUE_CONSTRAINT = "uq_invoices_quote_type_active";
/** Postgres unique_violation SQLSTATE — see MINOR-6 fix comments below. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

interface QuoteForInvoice extends QuoteRow {
  projects: { id: string; company_id: string } | null;
}

async function loadQuoteForInvoice(
  supabase: Client,
  quoteId: string,
): Promise<{ quote: QuoteForInvoice } | { error: string }> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*, projects(id, company_id)")
    .eq("id", quoteId)
    .maybeSingle();
  if (error) return { error: `Could not load the quote: ${error.message}` };
  if (!data) return { error: "Quote not found." };
  return { quote: data as unknown as QuoteForInvoice };
}

async function nextInvoiceNumber(supabase: Client): Promise<{ number: string } | { error: string }> {
  // MINOR-4 fix: Jamaica local time, not the server process's local time —
  // see lib/invoices/numbering.ts's jamaicaYear header for the full argument.
  const year = jamaicaYear();
  const { data, error } = await supabase.rpc("next_invoice_number", { p_year: year });
  if (error) return { error: `Could not allocate an invoice number: ${error.message}` };
  const sequence = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(sequence)) return { error: "Invoice numbering function returned an unexpected value." };
  return { number: formatInvoiceNumber(year, sequence) };
}

/** Fetches the existing non-void invoice of a given type for a quote, if any (used for the idempotent "already existed" path and for the balance generator's deposit lookup). */
async function findActiveInvoice(
  supabase: Client,
  quoteId: string,
  invoiceType: "deposit" | "balance",
): Promise<InvoiceRow | null> {
  const { data } = await supabase
    .from("invoices")
    .select("*")
    .eq("quote_id", quoteId)
    .eq("invoice_type", invoiceType)
    .neq("status", "void")
    .maybeSingle();
  return (data as InvoiceRow | null) ?? null;
}

/**
 * Deposit invoice generation (Task 46). Called from
 * app/admin/quotes/[id]/workflowActions.ts AFTER the quote's accept
 * transition has already committed — a failure here must never be
 * interpreted as "undo the accept"; the caller surfaces this result as a
 * secondary message on top of an already-successful accept.
 */
export async function generateDepositInvoiceForQuote(
  supabase: Client,
  quoteId: string,
  createdBy: string | null,
): Promise<GenerateInvoiceResult> {
  const loaded = await loadQuoteForInvoice(supabase, quoteId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { quote } = loaded;

  const amounts = computeDepositInvoiceAmounts(quote);
  const numberResult = await nextInvoiceNumber(supabase);
  if ("error" in numberResult) return { ok: false, error: numberResult.error };

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      invoice_number: numberResult.number,
      quote_id: quote.id,
      project_id: quote.projects?.id ?? quote.project_id ?? null,
      company_id: quote.projects?.company_id ?? null,
      invoice_type: "deposit",
      status: "draft",
      subtotal_jmd: amounts.subtotalJmd,
      gct_amount_jmd: amounts.gctAmountJmd,
      amount_jmd: amounts.amountJmd,
      amount_usd: amounts.amountUsd,
      fx_note: amounts.fxNote,
      due_note: "Deposit due on quote acceptance.",
      created_by: createdBy,
    })
    .select("*")
    .single();

  if (error) {
    // MINOR-6 fix: check the PostgREST/Postgres unique-violation error code
    // ('23505', https://www.postgresql.org/docs/current/errcodes-appendix.html)
    // first — stable across Postgres versions and never affected by message
    // wording/locale. The message-substring check is kept ONLY as a fallback
    // for a client/proxy that (unusually) omits `code`.
    if (error.code === POSTGRES_UNIQUE_VIOLATION || error.message.includes(UNIQUE_CONSTRAINT)) {
      const existing = await findActiveInvoice(supabase, quoteId, "deposit");
      if (existing) return { ok: true, invoice: existing, alreadyExisted: true };
    }
    return { ok: false, error: `Could not create the deposit invoice: ${error.message}` };
  }

  return { ok: true, invoice: data as InvoiceRow, alreadyExisted: false };
}

/**
 * Balance invoice generation (Task 47), triggered by "Mark customs cleared".
 * Requires an existing (non-void) deposit invoice to derive the remaining
 * balance from — its stored subtotal_jmd, not a fresh deposit_pct
 * recomputation, per lib/invoices/amounts.ts's rounding-fidelity contract.
 */
export async function generateBalanceInvoiceForQuote(
  supabase: Client,
  quoteId: string,
  createdBy: string | null,
): Promise<GenerateInvoiceResult> {
  const loaded = await loadQuoteForInvoice(supabase, quoteId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { quote } = loaded;

  const depositInvoice = await findActiveInvoice(supabase, quoteId, "deposit");
  if (!depositInvoice) {
    return {
      ok: false,
      error: "No deposit invoice was found for this quote — cannot compute the balance without it.",
    };
  }

  const amounts = computeBalanceInvoiceAmounts(quote, depositInvoice.subtotal_jmd ?? 0);
  const numberResult = await nextInvoiceNumber(supabase);
  if ("error" in numberResult) return { ok: false, error: numberResult.error };

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      invoice_number: numberResult.number,
      quote_id: quote.id,
      project_id: quote.projects?.id ?? quote.project_id ?? null,
      company_id: quote.projects?.company_id ?? null,
      invoice_type: "balance",
      status: "draft",
      subtotal_jmd: amounts.subtotalJmd,
      gct_amount_jmd: amounts.gctAmountJmd,
      amount_jmd: amounts.amountJmd,
      amount_usd: amounts.amountUsd,
      fx_note: amounts.fxNote,
      due_note: "Balance due on customs clearance.",
      created_by: createdBy,
    })
    .select("*")
    .single();

  if (error) {
    // MINOR-6 fix — see the deposit generator's identical comment above.
    if (error.code === POSTGRES_UNIQUE_VIOLATION || error.message.includes(UNIQUE_CONSTRAINT)) {
      const existing = await findActiveInvoice(supabase, quoteId, "balance");
      if (existing) return { ok: true, invoice: existing, alreadyExisted: true };
    }
    return { ok: false, error: `Could not create the balance invoice: ${error.message}` };
  }

  return { ok: true, invoice: data as InvoiceRow, alreadyExisted: false };
}

// ---------------------------------------------------------------------------
// Standalone (ad-hoc) invoice generation — founder request 2026-08-07: "a
// new invoice creation button in case we want to build an invoice from
// scratch." No quote, no idempotency-by-(quote_id, invoice_type) — every
// call intentionally creates a brand-new invoice, the same way clicking
// "Add project" creates a brand-new project every time.
// ---------------------------------------------------------------------------

export interface StandaloneInvoiceInput {
  companyId: string;
  projectId: string | null;
  lines: InvoiceLineItemDraft[];
  dueNote: string | null;
}

/**
 * Reads the LIVE `gct_enabled`/`gct_rate_pct` business parameters. A
 * standalone invoice has no source quote to freeze a `parameters_snapshot`
 * from (that snapshot only exists because a QUOTE was created at some past
 * date — see lib/quotes/snapshot.ts), so it is priced with whatever GCT
 * settings are current at the moment the founder clicks "Create invoice",
 * exactly like the FX/invoice-numbering sequence itself is resolved live at
 * creation time. Missing/malformed rows fall back to the same seed defaults
 * lib/quotes/snapshot.ts's buildParametersSnapshot uses (gct_enabled: false,
 * gct_rate_pct: 15) so a partially-seeded environment still produces a
 * coherent invoice.
 */
async function loadLiveGctSnapshot(
  supabase: Client,
): Promise<Pick<ParametersSnapshotStored, "gct_enabled" | "gct_rate_pct">> {
  const { data } = await supabase
    .from("business_parameters")
    .select("key, value")
    .in("key", ["gct_enabled", "gct_rate_pct"]);

  const rows = (data as { key: string; value?: { value?: unknown } }[] | null) ?? [];
  const rawFor = (key: string) => rows.find((r) => r.key === key)?.value?.value;

  const gctEnabledRaw = rawFor("gct_enabled");
  const gctRateRaw = rawFor("gct_rate_pct");
  const gctRateNum = typeof gctRateRaw === "string" ? Number(gctRateRaw) : gctRateRaw;

  return {
    gct_enabled: typeof gctEnabledRaw === "boolean" ? gctEnabledRaw : false,
    gct_rate_pct: typeof gctRateNum === "number" && Number.isFinite(gctRateNum) ? gctRateNum : 15,
  };
}

export type GenerateStandaloneInvoiceResult =
  | { ok: true; invoice: InvoiceRow }
  | { ok: false; error: string };

/**
 * Creates a standalone invoice: computes + validates its line items (pure,
 * lib/invoices/lineItems.ts), applies GCT the same way every other invoice
 * does (lib/invoices/amounts.ts's `computeStandaloneInvoiceAmounts`, which
 * reuses the SAME `gctForSubtotal` helper the deposit/balance generators
 * use — no second GCT calculation anywhere in this codebase), allocates a
 * number from the SAME race-safe `next_invoice_number` sequence
 * quote-derived invoices use (so a standalone invoice's number can never
 * collide with one generated from a quote), then inserts the invoice row and
 * its line items.
 *
 * The invoice row and its line items are two separate inserts (no
 * multi-statement transaction available through supabase-js here) — if the
 * line-item insert fails after the invoice insert succeeds, the just-created
 * invoice row is deleted so the caller never ends up with an orphaned
 * invoice that has amounts but no visible lines. The allocated invoice
 * number is not reused in that case (matching this codebase's existing
 * tolerance for numbering gaps on a failed/retried create — see
 * lib/invoices/numbering.ts's header: numbers are handed out, never taken
 * back).
 */
export async function generateStandaloneInvoice(
  supabase: Client,
  input: StandaloneInvoiceInput,
  createdBy: string | null,
): Promise<GenerateStandaloneInvoiceResult> {
  if (!input.companyId) return { ok: false, error: "Choose a company." };

  const { lines, subtotalJmd } = computeLineItemTotals(input.lines);
  if (lines.length === 0) {
    return { ok: false, error: "Add at least one line item with a description, quantity, and unit price." };
  }

  const gctSnapshot = await loadLiveGctSnapshot(supabase);
  const amounts = computeStandaloneInvoiceAmounts(subtotalJmd, gctSnapshot);

  const numberResult = await nextInvoiceNumber(supabase);
  if ("error" in numberResult) return { ok: false, error: numberResult.error };

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      invoice_number: numberResult.number,
      quote_id: null,
      project_id: input.projectId,
      company_id: input.companyId,
      invoice_type: "standalone",
      status: "draft",
      subtotal_jmd: amounts.subtotalJmd,
      gct_amount_jmd: amounts.gctAmountJmd,
      amount_jmd: amounts.amountJmd,
      amount_usd: null,
      fx_note: null,
      due_note: input.dueNote,
      created_by: createdBy,
    })
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: `Could not create the invoice: ${error.message}` };
  }

  const invoice = data as InvoiceRow;

  const { error: lineItemsError } = await supabase.from("invoice_line_items").insert(
    lines.map((l): Omit<InvoiceLineItemRow, "id" | "created_at" | "updated_at"> => ({
      invoice_id: invoice.id,
      description: l.description,
      qty: l.qty,
      unit_price_jmd: l.unitPriceJmd,
      line_total_jmd: l.lineTotalJmd,
      sort_order: l.sortOrder,
    })),
  );

  if (lineItemsError) {
    // Best-effort cleanup — see this function's header. Deleting is safe:
    // no payment can exist yet against an invoice that was never returned
    // to a caller.
    await supabase.from("invoices").delete().eq("id", invoice.id);
    return { ok: false, error: `Could not save the invoice's line items: ${lineItemsError.message}` };
  }

  return { ok: true, invoice };
}

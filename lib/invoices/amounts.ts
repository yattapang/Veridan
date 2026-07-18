/**
 * Invoice amount derivation — PURE, no Supabase client, no I/O (Task 46/47).
 *
 * GCT FIDELITY DECISION (reviewer's #1 Phase 2C check, per Phase2_Plan §6
 * Layer 2 checklist — "does JMD amount ever get recomputed from a live FX
 * parameter instead of the quote's stored snapshot"):
 *
 *   `quotes.total_client_jmd` is GCT-EXCLUSIVE. Evidence: `gct_enabled` and
 *   `gct_rate_pct` are frozen onto every quote's `parameters_snapshot`
 *   (lib/quotes/snapshot.ts buildParametersSnapshot) but a repo-wide search
 *   of lib/landed-cost/engine.ts — the sole place total_client_jmd/
 *   total_client_usd/total_landed_usd are computed — shows those two keys
 *   are never read there. The engine's client price is pure landed cost x
 *   margin, converted to JMD at fx_snapshot.effective_rate; GCT plays no
 *   part in it. So an invoice's subtotal (the deposit/balance SHARE of
 *   total_client_jmd) is likewise GCT-exclusive, and GCT must be added ON
 *   TOP of that subtotal here — never re-derived by re-running any part of
 *   the landed-cost engine, and never read from a LIVE business_parameters
 *   row. Every figure in this file comes from either `quote.total_client_jmd`
 *   (cached engine output) or `quote.parameters_snapshot`/`quote.fx_snapshot`
 *   (frozen at quote_date) — exactly the "same snapshot discipline as
 *   quotes" PRD §9.3 requires, and the reason an invoice's numbers stay
 *   fixed even if `gct_enabled`/`gct_rate_pct`/`fx_bank_sell_rate_usd_jmd`
 *   are edited in admin afterward (UAT §6.3 step 6).
 *
 * ROUNDING: JMD amounts round to 2dp (numeric(14,2), matching how
 * line_item-mode quote amounts round per lib/quote-pdf/format.ts's header
 * note). The balance invoice's subtotal is computed as
 * `total_client_jmd - depositSubtotalJmd` (the DEPOSIT INVOICE'S OWN STORED
 * subtotal, not a fresh `deposit_pct` recomputation) so deposit + balance
 * subtotals always sum to exactly `total_client_jmd`, cent for cent, with no
 * compounding rounding drift between the two invoices.
 */

import type { FxSnapshotStored, ParametersSnapshotStored, QuoteRow } from "@/lib/supabase/types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface InvoiceAmounts {
  subtotalJmd: number;
  gctAmountJmd: number;
  amountJmd: number;
  amountUsd: number | null;
  fxNote: string;
}

/**
 * Human-readable FX provenance string, e.g. "162.00 x 1.03 = 166.86" —
 * matches the worked example in the task brief. Built entirely from the
 * quote's frozen fx_snapshot, never a live parameter read.
 */
export function buildFxNote(fx: FxSnapshotStored): string {
  const bufferMultiplier = 1 + fx.fx_buffer_pct / 100;
  return `${fx.bank_sell_rate.toFixed(2)} x ${bufferMultiplier.toFixed(2)} = ${fx.effective_rate.toFixed(2)}`;
}

/** GCT on a given subtotal, per the quote's OWN frozen GCT snapshot — 0 when GCT was off at quote time. */
function gctForSubtotal(subtotalJmd: number, snapshot: Pick<ParametersSnapshotStored, "gct_enabled" | "gct_rate_pct">): number {
  if (!snapshot.gct_enabled) return 0;
  return round2(subtotalJmd * (snapshot.gct_rate_pct / 100));
}

/** Informational USD equivalent, converted via the quote's own locked effective_rate (JMD per 1 USD). */
function usdFromJmd(amountJmd: number, fx: Pick<FxSnapshotStored, "effective_rate">): number | null {
  if (!fx.effective_rate || !Number.isFinite(fx.effective_rate)) return null;
  return round2(amountJmd / fx.effective_rate);
}

type QuoteForInvoicing = Pick<QuoteRow, "total_client_jmd" | "deposit_pct" | "parameters_snapshot" | "fx_snapshot">;

/**
 * Deposit invoice amounts (Task 46): subtotal = total_client_jmd x
 * deposit_pct / 100, GCT added on top per the quote's snapshot.
 */
export function computeDepositInvoiceAmounts(quote: QuoteForInvoicing): InvoiceAmounts {
  const total = quote.total_client_jmd ?? 0;
  const subtotalJmd = round2(total * (quote.deposit_pct / 100));
  const gctAmountJmd = gctForSubtotal(subtotalJmd, quote.parameters_snapshot);
  const amountJmd = round2(subtotalJmd + gctAmountJmd);
  return {
    subtotalJmd,
    gctAmountJmd,
    amountJmd,
    amountUsd: usdFromJmd(amountJmd, quote.fx_snapshot),
    fxNote: buildFxNote(quote.fx_snapshot),
  };
}

/**
 * Balance invoice amounts (Task 47): subtotal = total_client_jmd minus the
 * DEPOSIT INVOICE'S OWN STORED subtotal (not a fresh deposit_pct
 * recomputation), so the two invoices' subtotals always sum exactly to the
 * quote total regardless of any rounding the deposit invoice's own subtotal
 * picked up. GCT is added on top per the same quote snapshot the deposit
 * invoice used (frozen — cannot have drifted between the two invoices).
 */
export function computeBalanceInvoiceAmounts(
  quote: Pick<QuoteForInvoicing, "total_client_jmd" | "parameters_snapshot" | "fx_snapshot">,
  depositSubtotalJmd: number,
): InvoiceAmounts {
  const total = quote.total_client_jmd ?? 0;
  const subtotalJmd = round2(total - depositSubtotalJmd);
  const gctAmountJmd = gctForSubtotal(subtotalJmd, quote.parameters_snapshot);
  const amountJmd = round2(subtotalJmd + gctAmountJmd);
  return {
    subtotalJmd,
    gctAmountJmd,
    amountJmd,
    amountUsd: usdFromJmd(amountJmd, quote.fx_snapshot),
    fxNote: buildFxNote(quote.fx_snapshot),
  };
}

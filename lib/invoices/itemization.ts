/**
 * Loads + computes an invoice's itemized breakdown from its source quote's
 * OWN quote_line_items (Phase 2C independent-review MAJOR-2 fix — spec §3
 * "line items carried over from the accepted quote's quote_line_items — no
 * re-keying"; UAT §6.3 step 2). Shared by lib/invoices/pdf.ts (the invoice
 * PDF's itemized section) and app/admin/invoices/[id]/page.tsx (a compact
 * on-screen version) so there is exactly one query + grouping path for both.
 *
 * DISPLAY ONLY: this never touches an invoice's own stored amounts
 * (subtotal_jmd/gct_amount_jmd/amount_jmd) — those remain the single source
 * of truth for what's actually due, per lib/invoices/amounts.ts's fidelity
 * discipline. The itemized grandTotalJmd here is the FULL quote's total
 * (sum of the door_register/line_item rows lib/quote-pdf/itemization.ts
 * groups, the exact same helper the quote PDF itself uses), which is why a
 * deposit/balance invoice's own amount never equals it — `note` explains
 * that so it reads as expected rather than as a discrepancy.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildItemizationNote } from "@/lib/invoice-pdf/format";
import { buildQuoteItemization, type QuoteItemization } from "@/lib/quote-pdf/itemization";
import { computeQuoteResult } from "@/lib/quotes/mapping";
import type {
  FxSnapshotStored,
  InvoiceType,
  ParametersSnapshotStored,
  QuoteLineItemWithDetails,
  QuoteOriginRow,
  QuoteRow,
} from "@/lib/supabase/types";

type Client = SupabaseClient;

export interface InvoiceItemization extends QuoteItemization {
  mode: "door_register" | "line_item";
  note: string;
}

export interface QuoteMetaForItemization {
  id: string;
  quote_mode: "door_register" | "line_item";
  margin_pct: number;
  deposit_pct: number;
  parameters_snapshot: ParametersSnapshotStored;
  fx_snapshot: FxSnapshotStored;
}

/**
 * Returns null (never throws) when the quote's origins/lines can't be
 * loaded — presentation only; callers must render the invoice's own amounts
 * regardless and simply omit the itemized section on a null result.
 */
export async function loadInvoiceItemization(
  supabase: Client,
  quote: QuoteMetaForItemization,
  invoiceType: InvoiceType,
): Promise<InvoiceItemization | null> {
  const [originsResult, linesResult] = await Promise.all([
    supabase.from("quote_origins").select("*").eq("quote_id", quote.id).order("origin_label"),
    supabase
      .from("quote_line_items")
      .select(
        "*, products(id, description, manufacturer, product_ref, unit), doors(id, door_number, floor), hardware_sets(id, code, name), suppliers(id, name)",
      )
      .eq("quote_id", quote.id)
      .order("sort_order"),
  ]);

  if (originsResult.error || linesResult.error) return null;

  const origins = (originsResult.data as QuoteOriginRow[]) ?? [];
  const lines = (linesResult.data as unknown as QuoteLineItemWithDetails[]) ?? [];
  const isDoorMode = quote.quote_mode === "door_register";

  const result = computeQuoteResult({
    // Only the fields buildQuoteCalculationInput actually reads
    // (quote_mode/margin_pct/parameters_snapshot/fx_snapshot) are populated
    // — computeQuoteResult never touches anything else on QuoteRow.
    quote: {
      quote_mode: quote.quote_mode,
      margin_pct: quote.margin_pct,
      parameters_snapshot: quote.parameters_snapshot,
      fx_snapshot: quote.fx_snapshot,
    } as unknown as QuoteRow,
    origins,
    lines,
  });

  const { doorGroups, flatLines, grandTotalJmd } = buildQuoteItemization({
    isDoorMode,
    lines,
    resultLines: result.lines,
    resultDoors: result.doors,
  });

  return {
    mode: isDoorMode ? "door_register" : "line_item",
    doorGroups,
    flatLines,
    grandTotalJmd,
    note: buildItemizationNote(invoiceType, quote.deposit_pct ?? null),
  };
}

/**
 * Loads a standalone (ad-hoc) invoice's OWN `invoice_line_items` and shapes
 * them into the SAME `InvoiceItemization` display shape
 * lib/invoices/itemization.ts builds for a quote-derived invoice — mirrors
 * `QuotePdfFlatLineRow` (description/qty/unitPriceJmd/lineTotalJmd) exactly,
 * so lib/invoices/pdf.ts's `ItemizedSection` and the invoice detail page's
 * "Itemized breakdown" table render a standalone invoice's lines with NO new
 * rendering code — same tables lib/quote-pdf/QuotePdf.tsx's line_item mode
 * already draws.
 *
 * Unlike lib/invoices/itemization.ts's `loadInvoiceItemization` (whose
 * grandTotalJmd is the FULL quote's total, deliberately different from a
 * deposit/balance invoice's own amount_jmd — see that file's header), a
 * standalone invoice's itemized total IS its own subtotal: there is no
 * deposit/balance share to explain away, so `note` says so plainly instead
 * of carrying the deposit/balance mismatch explanation.
 *
 * Returns null (never throws) when the lines can't be loaded — same
 * presentation-only contract as loadInvoiceItemization: callers always
 * render the invoice's own stored amounts regardless and simply omit the
 * itemized section on a null result.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuotePdfFlatLineRow } from "@/lib/quote-pdf/QuotePdf";
import type { InvoiceItemization } from "./itemization";
import type { InvoiceLineItemRow } from "@/lib/supabase/types";

type Client = SupabaseClient;

export async function loadStandaloneInvoiceItemization(
  supabase: Client,
  invoiceId: string,
): Promise<InvoiceItemization | null> {
  const { data, error } = await supabase
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sort_order", { ascending: true });

  if (error) return null;

  const rows = (data as InvoiceLineItemRow[]) ?? [];
  const flatLines: QuotePdfFlatLineRow[] = rows.map((r) => ({
    description: r.description,
    qty: Number(r.qty),
    unitPriceJmd: Number(r.unit_price_jmd),
    lineTotalJmd: Number(r.line_total_jmd),
  }));
  const grandTotalJmd = flatLines.reduce((sum, l) => sum + l.lineTotalJmd, 0);

  return {
    mode: "line_item",
    doorGroups: [],
    flatLines,
    grandTotalJmd,
    note: "Ad-hoc line items entered directly on this invoice — not linked to a quote.",
  };
}

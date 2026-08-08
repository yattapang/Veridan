/**
 * Standalone (ad-hoc) invoice line-item totalling — PURE, no Supabase
 * client, no I/O. Founder request 2026-08-07: a standalone invoice's line
 * items are free text (description, qty, unit price in JMD) rather than
 * `quote_line_items`, so unlike a quote-derived invoice there is no
 * landed-cost engine output to read a subtotal from — it has to be summed
 * from what the founder typed into the create form.
 *
 * Blank/invalid rows (empty description, non-finite or non-positive qty,
 * negative unit price) are dropped rather than surfaced as a computed 0-row
 * — a founder who leaves a trailing blank row in the form should not get an
 * invoice with a mystery J$0.00 line. Rounding uses the SAME round2 helper
 * lib/invoices/amounts.ts uses for every other JMD figure on an invoice, so
 * a line total and the invoice subtotal it feeds into never drift apart
 * from using two different rounding rules.
 */

import { round2 } from "./amounts";

export interface InvoiceLineItemDraft {
  description: string;
  qty: number;
  unitPriceJmd: number;
}

export interface InvoiceLineItemComputed {
  description: string;
  qty: number;
  unitPriceJmd: number;
  lineTotalJmd: number;
  /** 0-based position, in the order valid rows survive filtering — what gets stored as invoice_line_items.sort_order. */
  sortOrder: number;
}

export interface InvoiceLineItemTotals {
  lines: InvoiceLineItemComputed[];
  subtotalJmd: number;
}

/**
 * Filters out invalid rows, computes each valid row's line total
 * (qty x unitPriceJmd, rounded to 2dp), and sums them into the invoice's
 * subtotal (also rounded to 2dp — matches how every other JMD subtotal on
 * an invoice is stored, per lib/invoices/amounts.ts's header).
 */
export function computeLineItemTotals(drafts: InvoiceLineItemDraft[]): InvoiceLineItemTotals {
  const lines: InvoiceLineItemComputed[] = [];
  let subtotalJmd = 0;

  for (const draft of drafts) {
    const description = draft.description.trim();
    const qty = Number(draft.qty);
    const unitPriceJmd = Number(draft.unitPriceJmd);

    if (!description) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!Number.isFinite(unitPriceJmd) || unitPriceJmd < 0) continue;

    const lineTotalJmd = round2(qty * unitPriceJmd);
    lines.push({ description, qty, unitPriceJmd, lineTotalJmd, sortOrder: lines.length });
    subtotalJmd = round2(subtotalJmd + lineTotalJmd);
  }

  return { lines, subtotalJmd };
}

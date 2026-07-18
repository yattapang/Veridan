/**
 * Pure formatting helpers for the invoice PDF (Task 48a). No React-PDF
 * imports, no I/O — mirrors lib/quote-pdf/format.ts's role for quotes.
 *
 * Money formatting here is always 2dp (invoices are numeric(14,2), never the
 * whole-dollar door_register rounding quotes use) — these helpers format
 * what lib/invoices/amounts.ts already computed, they never re-derive a
 * total.
 */

import { formatIsoDate } from "../quote-pdf/format";
import type { InvoiceType } from "@/lib/supabase/types";

export { formatIsoDate };

/** JMD with 2 decimal places, e.g. `formatInvoiceJmd(69000)` -> "J$69,000.00". */
export function formatInvoiceJmd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return `J$${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Informational USD equivalent, e.g. `formatInvoiceUsd(413.52)` -> "US$413.52". */
export function formatInvoiceUsd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return `US$${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const INVOICE_PDF_TYPE_LABELS: Record<InvoiceType, string> = {
  deposit: "Deposit",
  balance: "Balance",
};

/**
 * Builds the deposit/balance context line shown under the amounts table,
 * e.g. "60% deposit against quote VQ-2026-001" or "Balance due against quote
 * VQ-2026-001". `depositPct` is only meaningful for the deposit invoice type
 * (the quote's own `deposit_pct`, never recomputed here) — a balance
 * invoice's line never mentions a percentage since it is defined as "what's
 * left", not a fixed share.
 */
export function buildDepositContextLine(
  invoiceType: InvoiceType,
  quoteRef: string | null | undefined,
  depositPct: number | null | undefined,
): string {
  const ref = quoteRef?.trim() || "—";
  if (invoiceType === "deposit") {
    const pct = depositPct != null && Number.isFinite(Number(depositPct)) ? Number(depositPct) : null;
    return pct != null ? `${pct}% deposit against quote ${ref}.` : `Deposit against quote ${ref}.`;
  }
  return `Balance due against quote ${ref}.`;
}

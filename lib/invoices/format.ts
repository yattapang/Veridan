/**
 * Shared display helpers for invoice UI (Tasks 44-49). Pure formatting only
 * — mirrors lib/quotes/format.ts's role for quotes, so the list and detail
 * views render statuses/types identically.
 */

import type { InvoiceStatus, InvoiceType } from "@/lib/supabase/types";

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  deposit: "Deposit",
  balance: "Balance",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  sent: "Sent",
  paid: "Paid",
  partially_paid: "Partially paid",
  void: "Void",
};

/** Tailwind classes for a status badge (matches the admin palette used by QUOTE_STATUS_BADGE). */
export const INVOICE_STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft: "bg-veridan-warm-gray-pale text-veridan-ink",
  issued: "bg-blue-50 text-blue-700",
  sent: "bg-blue-50 text-blue-700",
  partially_paid: "bg-amber-50 text-amber-700",
  paid: "bg-green-50 text-green-700",
  void: "bg-veridan-warm-gray-pale text-veridan-warm-gray",
};

/**
 * Shared display helpers for quote UI (Task 16). Pure formatting only — no
 * business logic, no I/O. Kept in one place so the list page, the builder,
 * and the project page render statuses / money identically.
 */

import type { OverrideType, QuoteStatus } from "@/lib/supabase/types";

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

/** Tailwind classes for a status badge (matches the admin palette). */
export const QUOTE_STATUS_BADGE: Record<QuoteStatus, string> = {
  draft: "bg-veridan-warm-gray-pale text-veridan-ink",
  approved: "bg-blue-50 text-blue-700",
  sent: "bg-blue-50 text-blue-700",
  viewed: "bg-blue-50 text-blue-700",
  accepted: "bg-green-50 text-green-700",
  declined: "bg-red-50 text-red-700",
  expired: "bg-veridan-warm-gray-pale text-veridan-warm-gray",
};

export const OVERRIDE_TYPE_LABELS: Record<OverrideType, string> = {
  margin_below_tier: "Margin below selected tier",
  margin_below_floor: "Margin below 20% floor",
  price_below_landed_cost: "Price below landed cost",
};

export function formatUsd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return Number(amount).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/** Whole-JMD by default (client-facing per-door prices round to whole dollars). */
export function formatJmd(amount: number | null | undefined, fractionDigits = 0): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return `J$${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value)}%`;
}

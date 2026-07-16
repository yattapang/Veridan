/**
 * Quote workflow states (Task 19) — PURE, no Supabase client, no I/O.
 * Mirrors the pattern of lib/quotes/snapshot.ts and lib/quotes/mapping.ts:
 * anything with actual business rules lives here and is unit-tested, so the
 * server actions in app/admin/quotes/[id]/workflowActions.ts are thin I/O
 * glue that trusts these guards rather than re-deriving them.
 *
 * Pipeline (§6.4, §1.7 status CHECK constraint):
 *   draft -> approved -> sent -> [viewed, Phase 2] -> accepted | declined
 *   sent | viewed -> expired (manual; also computed for display, see below)
 *
 * "viewed" is a Phase 2 status (Resend open-tracking) — the enum/CHECK
 * constraint already supports it (§1.7) but nothing in Phase 1 writes it.
 * Guards below still accept it as a valid FROM state for accept/decline/
 * expire so the transition table doesn't need revisiting when Phase 2 lands.
 */

import type { QuoteStatus } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

export type TransitionResult = { ok: true; error?: undefined } | { ok: false; error: string };

/**
 * Every status a quote may move TO from a given status. Terminal statuses
 * (accepted, declined, expired) have no outgoing transitions in Phase 1 —
 * a terminal quote is revised (a NEW draft row), never un-terminaled.
 */
const ALLOWED_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["approved"],
  approved: ["sent"],
  sent: ["accepted", "declined", "expired"],
  viewed: ["accepted", "declined", "expired"],
  accepted: [],
  declined: [],
  expired: [],
};

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "draft",
  approved: "approved",
  sent: "sent",
  viewed: "viewed",
  accepted: "accepted",
  declined: "declined",
  expired: "expired",
};

/** Validates a proposed status transition against the workflow's state machine. */
export function canTransition(from: QuoteStatus, to: QuoteStatus): TransitionResult {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `Cannot move a ${STATUS_LABELS[from]} quote to ${STATUS_LABELS[to]}.`,
    };
  }
  return { ok: true };
}

/**
 * Origin/margin/line editing actions are draft-only (§6.4 — a quote becomes
 * a client-facing document once approved; changes after that point are made
 * via a new revision, never by mutating the sent/approved quote). Single
 * source of truth for that rule so every editing action guards identically.
 */
export function canEdit(status: QuoteStatus): boolean {
  return status === "draft";
}

// ---------------------------------------------------------------------------
// Validity / expiry
// ---------------------------------------------------------------------------

/**
 * Adds `days` to an ISO `YYYY-MM-DD` date using pure calendar/UTC arithmetic
 * (no local-timezone Date construction — same approach as
 * lib/quote-pdf/format.ts formatValidUntil, kept independent here since that
 * module returns a formatted display string rather than a comparable ISO
 * date). Returns null for a malformed input rather than throwing, so callers
 * can fail soft.
 */
export function computeValidUntilIso(quoteDateIso: string, validityDays: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(quoteDateIso.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const days = Number.isFinite(validityDays) ? validityDays : 0;
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const target = new Date(base + days * 24 * 60 * 60 * 1000);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(
    target.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** True when `asOfIso` (default: today, UTC) is strictly past the quote's valid-until date. */
export function isPastValidUntil(
  quoteDateIso: string,
  validityDays: number,
  asOfIso: string = new Date().toISOString().slice(0, 10),
): boolean {
  const validUntil = computeValidUntilIso(quoteDateIso, validityDays);
  if (!validUntil) return false;
  return asOfIso > validUntil;
}

/**
 * The "expired" badge is display-level ONLY (build plan Task 19: "don't
 * mutate data silently") — it never writes the status column. It applies
 * only once a quote has actually been sent to the client (sent/viewed);
 * a draft or approved quote isn't running against a validity clock yet, and
 * a quote that already reached a terminal outcome (accepted/declined/
 * expired) doesn't need a second, contradictory badge layered on top.
 */
export function isComputedExpired(
  status: QuoteStatus,
  quoteDateIso: string,
  validityDays: number,
  asOfIso?: string,
): boolean {
  if (status !== "sent" && status !== "viewed") return false;
  return isPastValidUntil(quoteDateIso, validityDays, asOfIso);
}

// ---------------------------------------------------------------------------
// Revisions (§6.4 versioning: revisions are new rows, never overwrites)
// ---------------------------------------------------------------------------

export function nextRevisionNumber(currentRevisionNumber: number): number {
  return currentRevisionNumber + 1;
}

/**
 * A revision's quote_ref must be unique (§1.7 `quote_ref text not null
 * unique`) while still reading as "the same quote, a later version" —
 * `nextQuoteRef` (lib/quotes/mapping.ts) only ever mints a brand-new
 * VQ-YYYY-NNN ref for a NEW quote, so revisions get a `-R<n>` suffix on the
 * ORIGINAL base ref instead of consuming a fresh sequence number. Strips any
 * existing `-R<n>` suffix first so revising a revision doesn't chain
 * suffixes ("VQ-2026-003-R2-R3") — it always suffixes off the true base ref.
 */
export function revisionQuoteRef(currentRef: string, newRevisionNumber: number): string {
  const base = currentRef.replace(/-R\d+$/, "");
  return `${base}-R${newRevisionNumber}`;
}

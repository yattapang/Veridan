/**
 * Pure, server-side validation/normalization helpers for the quote-request
 * portal forms (Task 23 hardening pass). Deliberately has no imports from
 * "next/headers" or Supabase so it can be unit-tested directly and reused
 * by both pathway server actions.
 *
 * Client-side `required`/`type`/`accept` attributes are a UX convenience
 * only — a request can always be replayed directly against the server
 * action bypassing the browser, so every constraint enforced here is
 * re-checked independently of what the client sent.
 */

/** Max characters accepted for short single-line text fields (names, locations, etc). */
export const MAX_SHORT_TEXT_LENGTH = 200;

/** Max characters accepted for email addresses (RFC 5321 practical ceiling). */
export const MAX_EMAIL_LENGTH = 254;

/** Max characters accepted for phone number fields. */
export const MAX_PHONE_LENGTH = 40;

/** Max characters accepted for long free-text fields (notes, failing-hardware description). */
export const MAX_LONG_TEXT_LENGTH = 4000;

/** Max characters accepted per structured hardware-schedule line-item field. */
export const MAX_LINE_ITEM_FIELD_LENGTH = 500;

/**
 * Max structured line items accepted per submission. A real architect's
 * hardware schedule for even a large project rarely exceeds a few hundred
 * lines; this guards against a scripted submission trying to pad the
 * request into a huge payload / DB row.
 */
export const MAX_LINE_ITEMS = 200;

/**
 * Trims surrounding whitespace and collapses internal runs of whitespace
 * (including newlines within what's meant to be a single-line field) down
 * to single spaces, then truncates to `maxLength`. Returns "" for
 * null/undefined/non-string input.
 */
export function normalizeSingleLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, maxLength);
}

/**
 * Trims surrounding whitespace and truncates to `maxLength`, but preserves
 * internal line breaks (for multi-line fields like notes/descriptions).
 * Returns "" for null/undefined/non-string input.
 */
export function normalizeMultiLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Format + length check. Does not verify deliverability (no DNS/MX lookup). */
export function isValidEmail(value: string): boolean {
  return value.length > 0 && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

/**
 * True if the given structured line-item count is within the accepted
 * range (>0 and <= MAX_LINE_ITEMS). A submission with zero rows is a
 * separate "did you forget to fill this in" validation concern handled by
 * the caller, not this guard.
 */
export function isReasonableLineItemCount(count: number): boolean {
  return count <= MAX_LINE_ITEMS;
}

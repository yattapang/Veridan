/**
 * Invoice numbering — pure formatting only (Task 45).
 *
 * The race-safe part of numbering (handing out a unique integer per year)
 * lives entirely in Postgres: supabase/migrations/20260718000002_invoicing.sql
 * defines `invoice_counters` + `next_invoice_number(p_year int)`, an atomic
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` called via
 * `supabase.rpc("next_invoice_number", { p_year })`. This module only turns
 * the integer that function returns into the human-facing `VI-YYYY-NNN`
 * string — there is no read-then-write here, deliberately, since that's
 * exactly the race the task brief warns against (contrast with quotes'
 * `nextQuoteRef`, which reads existing refs in JS and is only backstopped by
 * a unique constraint; invoices use the stronger DB-side counter instead).
 */

/**
 * Formats a year + raw sequence number as `VI-YYYY-NNN` (zero-padded to at
 * least 3 digits — matches the quote_ref convention in
 * lib/quotes/mapping.ts's nextQuoteRef). A sequence past 999 simply widens
 * the field (`VI-2026-1000`) rather than wrapping or throwing.
 */
export function formatInvoiceNumber(year: number, sequence: number): string {
  const safeYear = Number.isFinite(year) ? Math.trunc(year) : 0;
  const safeSeq = Number.isFinite(sequence) && sequence > 0 ? Math.trunc(sequence) : 1;
  return `VI-${safeYear}-${String(safeSeq).padStart(3, "0")}`;
}

/** Parses a `VI-YYYY-NNN` invoice number back into its parts, or null if it doesn't match. */
export function parseInvoiceNumber(invoiceNumber: string): { year: number; sequence: number } | null {
  const m = /^VI-(\d{4})-(\d+)$/.exec(invoiceNumber.trim());
  if (!m) return null;
  return { year: Number(m[1]), sequence: Number(m[2]) };
}

/**
 * MINOR-4 fix (Phase 2C independent review): the calendar year to number an
 * invoice under, computed in JAMAICA local time rather than the server
 * process's local time (`new Date().getFullYear()`, which is wrong whenever
 * the server runs in a different timezone — e.g. UTC, where a Dec 31 evening
 * in Jamaica is already Jan 1 UTC, and the invoice would wrongly number under
 * next year).
 *
 * Jamaica is UTC-5 year-round — it does NOT observe daylight saving time
 * (America/Jamaica has been fixed at UTC-5 since 1983) — so a fixed 5-hour
 * offset is used rather than `Intl.DateTimeFormat` with a `timeZone` option.
 * This keeps the function pure and independent of the runtime's ICU/tz data
 * being present or up to date (the same reason lib/quote-pdf/format.ts's
 * date helpers avoid local-timezone `Date` math), while still being exactly
 * correct for this one fixed-offset zone.
 */
export function jamaicaYear(instant: Date = new Date()): number {
  const jamaicaMs = instant.getTime() - 5 * 60 * 60 * 1000;
  return new Date(jamaicaMs).getUTCFullYear();
}

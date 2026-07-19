/**
 * Date/period helpers for financial reports (Task 54) — PURE, no I/O.
 * Reuses the fixed UTC-5 Jamaica-local-time pattern established by
 * lib/invoices/numbering.ts's `jamaicaYear` (Jamaica does not observe DST,
 * so a fixed 5-hour offset is exact and avoids depending on the runtime's
 * ICU/timezone data).
 *
 * TWO DIFFERENT KINDS OF "DATE" FLOW INTO THESE REPORTS, DELIBERATELY
 * HANDLED DIFFERENTLY:
 *   - `date`-typed columns (`invoice_payments.paid_at`, `actual_costs.
 *     incurred_date`) are already unambiguous calendar dates with no time
 *     component — "2026-01-01" means the same calendar day everywhere.
 *     Bucketing these just takes the `YYYY-MM` prefix directly
 *     (`monthKeyFromDateOnly`); running them through a timezone-shift would
 *     actually introduce a bug (midnight UTC minus 5 hours rolls into the
 *     PREVIOUS day for a date-only string with no real "instant").
 *   - `timestamptz`-typed instants (e.g. an invoice's `created_at`/
 *     `issued_at`, shown for reference/ordering but never used as the sole
 *     input to a total) need the Jamaica-local conversion
 *     (`jamaicaMonthKeyFromTimestamp`) for the same reason `jamaicaYear`
 *     does: a UTC-clocked server must not silently bucket a late Jamaica
 *     evening into the next UTC day/month.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const JAMAICA_OFFSET_MS = 5 * 60 * 60 * 1000;

/** `YYYY-MM` straight from a `date`-typed (no time component) ISO string — no timezone math, see header. */
export function monthKeyFromDateOnly(dateIso: string): string {
  return dateIso.slice(0, 7);
}

/** `YYYY-MM` for a `timestamptz` instant, converted to Jamaica local time (fixed UTC-5, see header). */
export function jamaicaMonthKeyFromTimestamp(instant: string | Date): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const shifted = new Date(d.getTime() - JAMAICA_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}`;
}

/** Jamaica-local `YYYY-MM-DD` for "today" (fixed UTC-5), mirroring jamaicaYear's approach. */
export function jamaicaToday(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - JAMAICA_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export interface ReportDateRange {
  /** Inclusive, `YYYY-MM-DD`. */
  startIso: string;
  /** Inclusive, `YYYY-MM-DD` (report filters are typically date-only, so inclusive-both-ends reads more naturally in a UI than an exclusive end). */
  endIso: string;
}

/** Default report filter: year-to-date in Jamaica local time — Jan 1 through today, both inclusive. */
export function yearToDateRange(now: Date = new Date()): ReportDateRange {
  const today = jamaicaToday(now);
  return { startIso: `${today.slice(0, 4)}-01-01`, endIso: today };
}

/** True when `dateIso` (a `date`-typed, no-time string) falls within [startIso, endIso], both inclusive. */
export function isWithinReportRange(dateIso: string | null | undefined, range: ReportDateRange): boolean {
  if (!dateIso) return false;
  const d = dateIso.slice(0, 10);
  return d >= range.startIso && d <= range.endIso;
}

/** Sorted list of every `YYYY-MM` month key touched by [startIso, endIso], inclusive. */
export function monthKeysInRange(range: ReportDateRange): string[] {
  const [startY, startM] = range.startIso.split("-").map(Number);
  const [endY, endM] = range.endIso.split("-").map(Number);
  const keys: string[] = [];
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    keys.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

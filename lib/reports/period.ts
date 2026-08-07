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

/**
 * `YYYY-MM-DD` for a `timestamptz` instant, converted to Jamaica local time
 * (fixed UTC-5, see header). Used to give an accrual-basis revenue event a
 * calendar date: `invoices.issued_at` is a timestamptz, but an income
 * statement buckets by calendar day, and an invoice issued at 8pm Jamaica
 * time must not land in the next UTC day (or, at a month boundary, the next
 * month's column).
 */
export function jamaicaDateFromTimestamp(instant: string | Date): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const shifted = new Date(d.getTime() - JAMAICA_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Jamaica-local `YYYY-MM-DD` for "today" (fixed UTC-5), mirroring jamaicaYear's approach. */
export function jamaicaToday(now: Date = new Date()): string {
  return jamaicaDateFromTimestamp(now);
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

/**
 * The ONLY shape a report date parameter may take: a zero-padded ISO calendar
 * date. Deliberately strict — `2026-1-5` is rejected rather than silently
 * coerced, because these strings are compared as STRINGS throughout this
 * module (`isWithinReportRange`, `monthKeysInRange`) and an unpadded value
 * sorts wrongly against a padded one.
 */
export const REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a raw `start`/`end` pair off a query string into a range.
 *
 * A BLANK value means "use the fallback for that end" (so `?start=2026-04-01`
 * alone is a valid open-ended-to-today request). A MALFORMED value, or a
 * reversed pair where the start is after the end, yields `null` — the caller
 * decides what that means: a report page falls back to year-to-date, an
 * export route returns 400.
 *
 * This is also the gate that keeps unvalidated user text out of the
 * PostgREST filter strings lib/reports/load.ts interpolates a range into:
 * a value matching this pattern cannot contain a comma, parenthesis or dot
 * and so cannot restructure a filter expression.
 */
export function parseReportDateRange(
  startRaw: string | null | undefined,
  endRaw: string | null | undefined,
  fallback: ReportDateRange = yearToDateRange(),
): ReportDateRange | null {
  const start = (startRaw ?? "").trim();
  const end = (endRaw ?? "").trim();
  if (start !== "" && !REPORT_DATE_PATTERN.test(start)) return null;
  if (end !== "" && !REPORT_DATE_PATTERN.test(end)) return null;

  const startIso = start || fallback.startIso;
  const endIso = end || fallback.endIso;
  if (startIso > endIso) return null;

  return { startIso, endIso };
}

/** Shifts a `YYYY-MM-DD` calendar date by whole days, staying in UTC so no local-time drift creeps in. */
export function shiftIsoDate(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
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

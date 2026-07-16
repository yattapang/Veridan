/**
 * KPI computation (Task 20, PRD §8/§9.2) — PURE, no Supabase client, no I/O.
 * Takes plain rows (already fetched by the /admin/pipeline and /admin
 * pages) and returns the numbers + early-warning flags shown on both
 * pages' KPI tiles. Kept separate from data-fetching per this repo's
 * established split (lib/quotes/mapping.ts vs the server actions that call
 * it) so the arithmetic is unit-testable without a database.
 *
 * KPI formulas (per build plan §4 Task 20 / PRD §8, §9.2):
 * - Quote-to-order conversion % = accepted / (sent + accepted + declined +
 *   expired), current quarter, counted by `quotes.status`. 'approved' and
 *   'draft' are excluded (never reached the client); 'viewed' is a Phase 2
 *   status nothing in Phase 1 writes, also excluded from the literal
 *   denominator the plan specifies.
 * - Enquiry -> first-quote-sent turnaround = business days (lib/business-
 *   days.ts) from `enquiries.created_at` to the earliest `quotes.sent_at`
 *   for that enquiry's project, averaged across all pairs with both dates.
 * - Average accepted order value = mean of `total_client_jmd` /
 *   `total_client_usd` across quotes with status = 'accepted' (both are
 *   cached columns on `quotes`, computed once at send/accept time by the
 *   Task 9 engine — never re-derived here).
 * - Early-warning flags (PRD §8/§9.2):
 *     - conversion flag: the last two FULL calendar months (not the current,
 *       in-progress month) each show < 25% conversion.
 *     - margin flag: any accepted quote's effective margin
 *       (= (total_client_usd - total_landed_usd) / total_client_usd) is
 *       below the 20% hard floor (§6.3.4). Effective margin is derived from
 *       the cached totals Task 16 persisted on `quotes`, not re-run through
 *       the landed-cost engine.
 */

import type { QuoteStatus } from "@/lib/supabase/types";
import { averageBusinessDays } from "./business-days";

// ---------------------------------------------------------------------------
// Quarter / month range helpers
// ---------------------------------------------------------------------------

export interface DateRange {
  /** Inclusive, `YYYY-MM-DD`. */
  startIso: string;
  /** Exclusive, `YYYY-MM-DD` — the first day NOT in the range. */
  endIsoExclusive: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateIso(y: number, mZeroBased: number, d: number): string {
  return `${y}-${pad(mZeroBased + 1)}-${pad(d)}`;
}

/** Calendar-quarter range (UTC) containing `now`. Quarters: Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec. */
export function getCurrentQuarterRange(now: Date = new Date()): DateRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-11
  const qStartMonth = Math.floor(m / 3) * 3;
  const startIso = dateIso(y, qStartMonth, 1);
  const endMonth = qStartMonth + 3;
  const endIso = endMonth >= 12 ? dateIso(y + 1, endMonth - 12, 1) : dateIso(y, endMonth, 1);
  return { startIso, endIsoExclusive: endIso };
}

/** True when `dateIso` (any parseable date/timestamp string) falls within [startIso, endIsoExclusive). */
export function isWithinRange(iso: string | null | undefined, range: DateRange): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= range.startIso && d < range.endIsoExclusive;
}

/** `YYYY-MM` key for grouping by calendar month (UTC). */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * The two full calendar months immediately preceding the month containing
 * `now`, oldest first — e.g. if `now` is in July, returns [May, June]. The
 * current, still-in-progress month is deliberately excluded, since a
 * partial month's conversion rate isn't a fair "two months running" signal.
 */
export function lastTwoFullMonthKeys(now: Date = new Date()): [string, string] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const prev1 = new Date(Date.UTC(y, m - 1, 1));
  const prev2 = new Date(Date.UTC(y, m - 2, 1));
  return [
    `${prev2.getUTCFullYear()}-${pad(prev2.getUTCMonth() + 1)}`,
    `${prev1.getUTCFullYear()}-${pad(prev1.getUTCMonth() + 1)}`,
  ];
}

// ---------------------------------------------------------------------------
// Quote-to-order conversion
// ---------------------------------------------------------------------------

/** Statuses counted in the conversion denominator — quotes that reached the client with a resolved-or-resolvable outcome. */
const CONVERSION_DENOMINATOR_STATUSES: QuoteStatus[] = ["sent", "accepted", "declined", "expired"];

export interface ConversionResult {
  acceptedCount: number;
  resolvedCount: number;
  /** Null when there's no data yet (avoids showing a misleading 0%). */
  conversionPct: number | null;
}

export function computeConversionRate(quotes: { status: QuoteStatus }[]): ConversionResult {
  const resolved = quotes.filter((q) => CONVERSION_DENOMINATOR_STATUSES.includes(q.status));
  const accepted = resolved.filter((q) => q.status === "accepted");
  return {
    acceptedCount: accepted.length,
    resolvedCount: resolved.length,
    conversionPct: resolved.length === 0 ? null : (accepted.length / resolved.length) * 100,
  };
}

/**
 * Monthly conversion rate, keyed by `monthKey`, for early-warning tracking.
 * `outcomeDateIso` should be the date that "settles" the quote into the
 * denominator — accepted_at/declined_at for a resolved quote, sent_at for a
 * still-pending 'sent' or a lapsed 'expired' one (its clock started at send).
 */
export function computeMonthlyConversion(
  quotes: { status: QuoteStatus; outcomeDateIso: string | null }[],
): Map<string, ConversionResult> {
  const byMonth = new Map<string, { status: QuoteStatus }[]>();
  for (const q of quotes) {
    if (!q.outcomeDateIso || !CONVERSION_DENOMINATOR_STATUSES.includes(q.status)) continue;
    const key = monthKey(q.outcomeDateIso);
    const bucket = byMonth.get(key) ?? [];
    bucket.push({ status: q.status });
    byMonth.set(key, bucket);
  }
  const result = new Map<string, ConversionResult>();
  for (const [key, bucket] of byMonth) {
    result.set(key, computeConversionRate(bucket));
  }
  return result;
}

/** Trips only when BOTH of the last two full months have data AND both are below the 25% threshold (PRD §8/§9.2: "conversion <25% two consecutive months"). */
export function isConversionEarlyWarning(
  monthlyConversion: Map<string, ConversionResult>,
  now: Date = new Date(),
  thresholdPct = 25,
): boolean {
  const [earlier, later] = lastTwoFullMonthKeys(now);
  const a = monthlyConversion.get(earlier);
  const b = monthlyConversion.get(later);
  if (!a || !b || a.conversionPct == null || b.conversionPct == null) return false;
  return a.conversionPct < thresholdPct && b.conversionPct < thresholdPct;
}

// ---------------------------------------------------------------------------
// Turnaround (enquiry -> first quote sent)
// ---------------------------------------------------------------------------

export function computeAverageTurnaroundBusinessDays(
  pairs: { enquiryCreatedAtIso: string; firstQuoteSentAtIso: string }[],
): number | null {
  return averageBusinessDays(
    pairs.map((p) => ({ startIso: p.enquiryCreatedAtIso, endIso: p.firstQuoteSentAtIso })),
  );
}

// ---------------------------------------------------------------------------
// Average accepted order value
// ---------------------------------------------------------------------------

export interface AverageOrderValueResult {
  count: number;
  avgJmd: number | null;
  avgUsd: number | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeAverageOrderValue(
  acceptedQuotes: { total_client_jmd: number | null; total_client_usd: number | null }[],
): AverageOrderValueResult {
  const jmdValues = acceptedQuotes
    .map((q) => q.total_client_jmd)
    .filter((v): v is number => v != null);
  const usdValues = acceptedQuotes
    .map((q) => q.total_client_usd)
    .filter((v): v is number => v != null);
  return {
    count: acceptedQuotes.length,
    avgJmd: average(jmdValues),
    avgUsd: average(usdValues),
  };
}

// ---------------------------------------------------------------------------
// Margin early-warning
// ---------------------------------------------------------------------------

export const MARGIN_FLOOR_PCT = 20;

/** (client price - landed cost) / client price, as a percent. Null when totals aren't both present/positive (data not yet computed). */
export function computeEffectiveMarginPct(quote: {
  total_client_usd: number | null;
  total_landed_usd: number | null;
}): number | null {
  const { total_client_usd, total_landed_usd } = quote;
  if (total_client_usd == null || total_landed_usd == null || total_client_usd <= 0) return null;
  return ((total_client_usd - total_landed_usd) / total_client_usd) * 100;
}

export interface MarginFlagQuote {
  id: string;
  quote_ref: string;
  effectiveMarginPct: number;
}

/** Accepted quotes whose effective margin is below the 20% floor — the PRD's "any order margin <20%" trigger. */
export function findMarginBreaches(
  acceptedQuotes: { id: string; quote_ref: string; total_client_usd: number | null; total_landed_usd: number | null }[],
  floorPct = MARGIN_FLOOR_PCT,
): MarginFlagQuote[] {
  const breaches: MarginFlagQuote[] = [];
  for (const q of acceptedQuotes) {
    const pct = computeEffectiveMarginPct(q);
    if (pct != null && pct < floorPct) {
      breaches.push({ id: q.id, quote_ref: q.quote_ref, effectiveMarginPct: pct });
    }
  }
  return breaches;
}

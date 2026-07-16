/**
 * Pure formatting helpers for the quote PDF (Task 18). No React-PDF imports,
 * no I/O — kept separate from QuotePdf.tsx so the logic that actually needs
 * unit-test coverage (money formatting, HW-group composition summaries, door
 * number truncation, date math) doesn't get tangled up with JSX rendering,
 * which react-pdf doesn't need tests for.
 *
 * Rounding: JMD client-facing amounts arrive from the engine already rounded
 * per §3.3 (whole-dollar per door in door_register mode, 2dp per line in
 * line_item mode); these helpers format what they're given rather than
 * re-deriving totals, so "grand total = sum of rounded components" holds.
 */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Whole-dollar JMD, e.g. `formatJmdWhole(1234567.4)` -> "J$1,234,567". */
export function formatJmdWhole(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return `J$${Math.round(Number(amount)).toLocaleString("en-US")}`;
}

/** JMD with 2 decimal places, for line_item-mode per-unit/line prices. */
export function formatJmd2dp(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return `J$${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Plain thousands-grouped integer, e.g. for a quantity or door count. */
export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-US");
}

/**
 * Formats an ISO `YYYY-MM-DD` date string as "15 July 2026". Parses the date
 * components directly (no `Date` timezone math) so the result is stable
 * regardless of the runtime's local timezone — important for a server-
 * rendered PDF that must not drift by a day depending on where it runs.
 */
export function formatIsoDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  const monthName = MONTH_NAMES[Number(mo) - 1];
  if (!monthName) return isoDate;
  return `${Number(d)} ${monthName} ${y}`;
}

/**
 * Adds `days` to an ISO `YYYY-MM-DD` date string using pure calendar/UTC
 * arithmetic (no local-timezone Date construction) and formats the result
 * the same way as `formatIsoDate`. Used for "valid until" = quote_date +
 * validity_days.
 */
export function formatValidUntil(
  quoteDateIso: string | null | undefined,
  validityDays: number | null | undefined,
): string {
  if (!quoteDateIso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(quoteDateIso.trim());
  if (!m) return "—";
  const [, y, mo, d] = m;
  const days = Number.isFinite(Number(validityDays)) ? Number(validityDays) : 0;
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const target = new Date(base + days * 24 * 60 * 60 * 1000);
  const iso = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(
    target.getUTCDate(),
  ).padStart(2, "0")}`;
  return formatIsoDate(iso);
}

/**
 * Builds a one-line composition summary for a hardware set from its member
 * quote lines, e.g. "Lockset, Hinges x3, Closer". Duplicate descriptions
 * (same product appearing on more than one member line, e.g. one per leaf of
 * a double door) are merged and their quantities summed; a qty of 1 is shown
 * bare, anything higher gets an "xN" suffix. Order follows first appearance
 * so the summary is stable and matches how the set was built.
 */
export function summarizeComposition(
  items: Array<{ description: string; qty: number }>,
): string {
  const order: string[] = [];
  const totals = new Map<string, number>();
  for (const item of items) {
    const label = item.description?.trim() || "Item";
    if (!totals.has(label)) order.push(label);
    totals.set(label, (totals.get(label) ?? 0) + (Number.isFinite(item.qty) ? item.qty : 0));
  }
  return order.map((label) => (totals.get(label)! > 1 ? `${label} x${totals.get(label)}` : label)).join(", ");
}

/**
 * Formats a list of door numbers for a HW-group row, truncating past
 * `maxShown` with a "+N more" suffix, e.g. `["DE01","DA08","DA09","DA10"]`
 * with `maxShown = 2` -> "DE01, DA08 … +2 more". Door numbers are sorted
 * (natural string sort) and de-duplicated first so the same door never
 * appears twice regardless of how many lines it contributes.
 */
export function formatDoorNumbers(doorNumbers: string[], maxShown = 2): string {
  const unique = [...new Set(doorNumbers.filter((n) => n && n.trim().length > 0))].sort();
  if (unique.length === 0) return "—";
  if (unique.length <= maxShown) return unique.join(", ");
  const shown = unique.slice(0, maxShown);
  const remaining = unique.length - maxShown;
  return `${shown.join(", ")} … +${remaining} more`;
}

/**
 * Resolves a quote_origins.origin_label (e.g. "UK–Consort", "USA") to a
 * per-origin lead-time entry in the parameters_snapshot's lead_times table
 * (keyed by broad region, e.g. "USA", "UK", "Canada", "Dubai" — see
 * supabase/migrations/20260713000003_seed_parameters.sql). Tries an exact
 * (case-insensitive) match first, then falls back to whichever lead_times key
 * the origin label starts with, since origin_label often carries a supplier
 * suffix ("UK–Consort") on top of the plain region the lead-time table uses.
 * Returns null when no key matches so the caller can omit the origin from the
 * lead-time section rather than show a wrong or blank line.
 */
export function matchLeadTime(
  originLabel: string,
  leadTimes: Record<string, string> | null | undefined,
): string | null {
  if (!leadTimes) return null;
  const label = originLabel.trim().toLowerCase();
  for (const [key, value] of Object.entries(leadTimes)) {
    if (key.trim().toLowerCase() === label) return value;
  }
  for (const [key, value] of Object.entries(leadTimes)) {
    if (label.startsWith(key.trim().toLowerCase())) return value;
  }
  return null;
}

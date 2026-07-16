/**
 * Business-days helper (Task 20) — PURE, no I/O. Used by lib/kpis.ts to
 * turn "enquiry received" -> "first quote sent" timestamp pairs into a
 * business-day turnaround figure for the pipeline/dashboard KPI tiles.
 *
 * Scope, deliberately: weekends (Saturday/Sunday) only. There is no
 * Jamaican public-holiday table in Phase 1 — flagged here and in the build
 * plan reply as a future refinement, not a silent gap.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 0 = Sunday, 6 = Saturday (JS Date convention, evaluated in UTC). */
function isWeekend(utcMidnight: number): boolean {
  const day = new Date(utcMidnight).getUTCDay();
  return day === 0 || day === 6;
}

function toUtcMidnight(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Number of business days (Mon-Fri) between two ISO timestamps, counting
 * the start day but not the end day if it falls on the same calendar day
 * (i.e. same-day turnaround = 0 business days). Returns null for
 * unparseable input or when `endIso` is before `startIso` (a data error —
 * callers should exclude the pair rather than show a negative number).
 *
 * Weekend days in the range are not counted; a start or end that itself
 * falls on a weekend still contributes its weekday neighbours correctly
 * since we walk day-by-day rather than using a closed-form formula.
 */
export function businessDaysBetween(startIso: string, endIso: string): number | null {
  const start = toUtcMidnight(startIso);
  const end = toUtcMidnight(endIso);
  if (start == null || end == null) return null;
  if (end < start) return null;

  let days = 0;
  for (let t = start; t < end; t += MS_PER_DAY) {
    if (!isWeekend(t)) days += 1;
  }
  return days;
}

/**
 * Average business-day turnaround across a list of {startIso, endIso}
 * pairs, skipping any pair that fails to parse. Returns null when there is
 * no usable data (distinct from 0, which is a real "same day" average).
 */
export function averageBusinessDays(
  pairs: { startIso: string; endIso: string }[],
): number | null {
  const values = pairs
    .map((p) => businessDaysBetween(p.startIso, p.endIso))
    .filter((v): v is number => v != null);
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

/**
 * Shared plumbing for the report export route handlers (Task 56): query-range
 * parsing (`?from=&to=`, YTD default) and the auth-gated response helpers.
 * Exports carry client pricing and realized margins, so every route is
 * founder-session-only — the same getCurrentUser gate every /admin page and
 * the invoice/quote PDF routes use.
 */

import { NextResponse } from "next/server";
import { parseReportDateRange, type ReportDateRange } from "./period";

/**
 * Reads `from`/`to` (YYYY-MM-DD) off the request URL, falling back to
 * year-to-date when a value is absent.
 *
 * Returns `null` — never a silently repaired range — when a value is
 * malformed or the pair is reversed, so the route can answer 400 rather
 * than serve a file whose period is not the period the caller asked for.
 * The strictness is also what keeps unvalidated query text out of the
 * PostgREST filter strings lib/reports/load.ts builds from a range.
 */
export function parseExportRange(request: Request): ReportDateRange | null {
  const url = new URL(request.url);
  return parseReportDateRange(url.searchParams.get("from"), url.searchParams.get("to"));
}

/** A downloadable CSV response with the right headers and no caching. */
export function csvResponse(document: string, filename: string): NextResponse {
  return new NextResponse(document, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** A downloadable .xlsx response for a pre-built workbook buffer (mirrors the invoice/quote PDF routes' Uint8Array body). */
export function xlsxResponse(buffer: ArrayBuffer, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** A rejected `?from=&to=` pair. Built fresh per call — a NextResponse body may only be consumed once. */
export function invalidRangeResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Invalid date range. `from` and `to` must be YYYY-MM-DD (zero-padded), and `from` must not be after `to`.",
    },
    { status: 400 },
  );
}

export const NOT_AUTHENTICATED = NextResponse.json({ error: "Not authenticated." }, { status: 401 });
export const SUPABASE_NOT_CONFIGURED = NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });

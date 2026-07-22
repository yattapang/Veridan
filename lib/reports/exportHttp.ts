/**
 * Shared plumbing for the report export route handlers (Task 56): query-range
 * parsing (`?from=&to=`, YTD default) and the auth-gated response helpers.
 * Exports carry client pricing and realized margins, so every route is
 * founder-session-only — the same getCurrentUser gate every /admin page and
 * the invoice/quote PDF routes use.
 */

import { NextResponse } from "next/server";
import { yearToDateRange, type ReportDateRange } from "./period";

/** Reads `from`/`to` (YYYY-MM-DD) off the request URL, falling back to year-to-date. */
export function parseExportRange(request: Request): ReportDateRange {
  const url = new URL(request.url);
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const fallback = yearToDateRange();
  return {
    startIso: from || fallback.startIso,
    endIso: to || fallback.endIso,
  };
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

export const NOT_AUTHENTICATED = NextResponse.json({ error: "Not authenticated." }, { status: 401 });
export const SUPABASE_NOT_CONFIGURED = NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });

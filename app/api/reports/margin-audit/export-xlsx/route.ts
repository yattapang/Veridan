/**
 * GET /api/reports/margin-audit/export-xlsx?from=&to= — margin audit as an
 * Excel workbook (Task 56), one sheet per section with currency/percent
 * number formats. Auth-gated. Node runtime (exceljs is Node-only, not
 * edge-compatible).
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { invalidRangeResponse, NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED, xlsxResponse } from "@/lib/reports/exportHttp";
import { loadMarginAuditData } from "@/lib/reports/load";
import { buildMarginAudit } from "@/lib/reports/marginAudit";
import { buildMarginAuditWorkbook } from "@/lib/reports/xlsx";
import { NextResponse } from "next/server";
import { requireFounderRoute } from "@/lib/roles/guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NOT_AUTHENTICATED;

  // Founder-only, re-derived here and not inherited from any page guard: an
  // export route is a plain GET URL that a signed-in staff session could hit
  // directly. 403 with no body rather than a redirect a fetch would follow.
  const founderGate = await requireFounderRoute();
  if (!founderGate.ok) return founderGate.response;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return SUPABASE_NOT_CONFIGURED;
  }

  const range = parseExportRange(request);
  if (!range) return invalidRangeResponse();
  const { data, error } = await loadMarginAuditData(supabase, range);
  if (error || !data) {
    return NextResponse.json({ error: error ?? "Could not load report." }, { status: 500 });
  }

  const report = buildMarginAudit(data.orders, data.costs, data.payments, data.invoices);
  const buffer = await buildMarginAuditWorkbook(report, range);

  return xlsxResponse(buffer, `veridan-margin-audit-${range.startIso}-to-${range.endIso}.xlsx`);
}

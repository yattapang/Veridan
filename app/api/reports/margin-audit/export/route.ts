/**
 * GET /api/reports/margin-audit/export?from=&to= — margin audit as CSV
 * (Task 56). Auth-gated. Sections: summary, per-order, category variances.
 * This is the one report whose CSV legitimately contains quoted figures — as
 * the audited projection baseline (see lib/reports/marginAudit.ts).
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { buildCsvDocument } from "@/lib/reports/csv";
import { csvResponse, NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED } from "@/lib/reports/exportHttp";
import { loadMarginAuditData } from "@/lib/reports/load";
import { buildMarginAudit } from "@/lib/reports/marginAudit";
import { marginAuditToCsvRows } from "@/lib/reports/serialize";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NOT_AUTHENTICATED;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return SUPABASE_NOT_CONFIGURED;
  }

  const range = parseExportRange(request);
  const { data, error } = await loadMarginAuditData(supabase, range);
  if (error || !data) {
    return NextResponse.json({ error: error ?? "Could not load report." }, { status: 500 });
  }

  const report = buildMarginAudit(data.orders, data.costs, data.payments, data.invoices);
  const csv = buildCsvDocument(marginAuditToCsvRows(report, range));

  return csvResponse(csv, `veridan-margin-audit-${range.startIso}-to-${range.endIso}.csv`);
}

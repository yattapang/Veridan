/**
 * GET /api/reports/pnl/export?from=&to= — P&L as CSV (Task 56). Auth-gated;
 * data comes from loadPnlData (invoice_payments + actual_costs), never quote
 * projections.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { buildCsvDocument } from "@/lib/reports/csv";
import { csvResponse, NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED } from "@/lib/reports/exportHttp";
import { loadPnlData } from "@/lib/reports/load";
import { computePnlByMonth, computePnlByOrder } from "@/lib/reports/pnl";
import { pnlToCsvRows } from "@/lib/reports/serialize";
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
  const { data, error } = await loadPnlData(supabase, range);
  if (error || !data) {
    return NextResponse.json({ error: error ?? "Could not load report." }, { status: 500 });
  }

  const monthly = computePnlByMonth(data.payments, data.costs, data.rateByOrderId, range);
  const byOrder = computePnlByOrder(data.payments, data.costs, data.rateByOrderId, range);
  const csv = buildCsvDocument(pnlToCsvRows(monthly, byOrder, range));

  return csvResponse(csv, `veridan-pnl-${range.startIso}-to-${range.endIso}.csv`);
}

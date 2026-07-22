/**
 * GET /api/reports/cashflow/export?from=&to= — cash flow as CSV (Task 56).
 * Auth-gated; every amount is a recorded invoice_payment.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { computeCashFlowByMonth } from "@/lib/reports/cashflow";
import { buildCsvDocument } from "@/lib/reports/csv";
import { csvResponse, NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED } from "@/lib/reports/exportHttp";
import { loadCashFlowData } from "@/lib/reports/load";
import { cashFlowToCsvRows } from "@/lib/reports/serialize";
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
  const { data, error } = await loadCashFlowData(supabase, range);
  if (error || !data) {
    return NextResponse.json({ error: error ?? "Could not load report." }, { status: 500 });
  }

  const monthly = computeCashFlowByMonth(data, range);
  const csv = buildCsvDocument(cashFlowToCsvRows(monthly, range));

  return csvResponse(csv, `veridan-cashflow-${range.startIso}-to-${range.endIso}.csv`);
}

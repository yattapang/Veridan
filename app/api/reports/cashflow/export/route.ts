/**
 * GET /api/reports/cashflow/export?from=&to= — the cash-flow statement as CSV.
 *
 * Auth-gated. Cash IN is every recorded invoice_payment; cash OUT is every
 * actual_cost and expense that carries a paid_date. There is deliberately no
 * `basis` parameter — a cash-flow statement is cash basis by definition (see
 * lib/reports/cashflow.ts).
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { computeCashFlowByMonth } from "@/lib/reports/cashflow";
import { buildCsvDocument } from "@/lib/reports/csv";
import { csvResponse, NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED } from "@/lib/reports/exportHttp";
import { buildCashOutEntries, loadFinancialStatementData } from "@/lib/reports/load";
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
  const { data, error } = await loadFinancialStatementData(supabase, range);
  if (error || !data) {
    return NextResponse.json({ error: error ?? "Could not load report." }, { status: 500 });
  }

  const { entries: outEntries } = buildCashOutEntries(data);
  const monthly = computeCashFlowByMonth(data.cashIn, range, outEntries);
  const csv = buildCsvDocument(cashFlowToCsvRows(monthly, range));

  return csvResponse(csv, `veridan-cashflow-${range.startIso}-to-${range.endIso}.csv`);
}

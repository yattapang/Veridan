/**
 * GET /api/reports/pnl/export?from=&to=&basis= — the income statement as CSV.
 *
 * Auth-gated (every export carries client pricing and realized margins).
 * Data comes from loadFinancialStatementData — issued invoices,
 * invoice_payments, actual_costs and expenses — never quote projections.
 *
 * `basis` defaults to accrual, exactly as the on-screen report does, and the
 * chosen basis is written into the filename as well as the file body so two
 * downloads of the same period cannot be confused for each other on disk.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { parseReportBasis } from "@/lib/reports/basis";
import { buildCsvDocument } from "@/lib/reports/csv";
import { csvResponse, NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED } from "@/lib/reports/exportHttp";
import { buildIncomeStatement } from "@/lib/reports/incomeStatement";
import { loadFinancialStatementData } from "@/lib/reports/load";
import { incomeStatementToCsvRows } from "@/lib/reports/serialize";
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
  const basis = parseReportBasis(new URL(request.url).searchParams.get("basis"));

  const { data, error } = await loadFinancialStatementData(supabase, range);
  if (error || !data) {
    return NextResponse.json({ error: error ?? "Could not load report." }, { status: 500 });
  }

  const statement = buildIncomeStatement(
    {
      issuedInvoices: data.issuedInvoices,
      payments: data.payments,
      costs: data.costs,
      expenses: data.expenses,
      rateByOrderId: data.rateByOrderId,
      fx: data.fx,
    },
    range,
    basis,
  );
  const csv = buildCsvDocument(incomeStatementToCsvRows(statement));

  return csvResponse(csv, `veridan-income-statement-${basis}-${range.startIso}-to-${range.endIso}.csv`);
}

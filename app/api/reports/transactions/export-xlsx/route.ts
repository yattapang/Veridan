/**
 * GET /api/reports/transactions/export-xlsx?from=&to=&basis=&type=… — the
 * transaction detail ledger as an Excel workbook (Transactions / By type /
 * About). Auth-gated. Node runtime, as exceljs is Node-only and not
 * edge-compatible — same as the margin-audit workbook route.
 *
 * `basis` defaults to accrual and is written into the filename as well as
 * every sheet, since the two bases produce genuinely different rows.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { parseReportBasis } from "@/lib/reports/basis";
import { invalidRangeResponse, NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED, xlsxResponse } from "@/lib/reports/exportHttp";
import { loadFinancialStatementData } from "@/lib/reports/load";
import { buildTransactionLedger, parseTransactionTypes } from "@/lib/reports/transactions";
import { buildTransactionLedgerWorkbook } from "@/lib/reports/xlsx";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
  if (!range) return invalidRangeResponse();
  const params = new URL(request.url).searchParams;
  const basis = parseReportBasis(params.get("basis"));
  const types = parseTransactionTypes(params.getAll("type"));

  const { data, error } = await loadFinancialStatementData(supabase, range);
  if (error || !data) {
    return NextResponse.json({ error: error ?? "Could not load report." }, { status: 500 });
  }

  const ledger = buildTransactionLedger(
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
    { types },
  );
  const buffer = await buildTransactionLedgerWorkbook(ledger, range);

  return xlsxResponse(buffer, `veridan-transactions-${basis}-${range.startIso}-to-${range.endIso}.xlsx`);
}

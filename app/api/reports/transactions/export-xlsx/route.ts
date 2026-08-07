/**
 * GET /api/reports/transactions/export-xlsx?from=&to=&type=… — the
 * transaction detail ledger as an Excel workbook (Transactions / By type /
 * About). Auth-gated. Node runtime, as exceljs is Node-only and not
 * edge-compatible — same as the margin-audit workbook route.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED, xlsxResponse } from "@/lib/reports/exportHttp";
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
  const types = parseTransactionTypes(new URL(request.url).searchParams.getAll("type"));

  const { data, error } = await loadFinancialStatementData(supabase, range);
  if (error || !data) {
    return NextResponse.json({ error: error ?? "Could not load report." }, { status: 500 });
  }

  const ledger = buildTransactionLedger(
    {
      payments: data.payments,
      costs: data.costs,
      expenses: data.expenses,
      rateByOrderId: data.rateByOrderId,
      fx: data.fx,
    },
    range,
    { types },
  );
  const buffer = await buildTransactionLedgerWorkbook(ledger, range);

  return xlsxResponse(buffer, `veridan-transactions-${range.startIso}-to-${range.endIso}.xlsx`);
}

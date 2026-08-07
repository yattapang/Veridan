/**
 * GET /api/reports/transactions/export?from=&to=&type=… — the transaction
 * detail ledger as CSV. Auth-gated.
 *
 * `type` may be repeated or comma-joined ("customer_payment,operating_expense");
 * omitting it returns every type, which is the form the accountant normally
 * wants. Invalid values are dropped rather than erroring — a stale bookmark
 * should still produce a usable file.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { buildCsvDocument } from "@/lib/reports/csv";
import { csvResponse, NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED } from "@/lib/reports/exportHttp";
import { loadFinancialStatementData } from "@/lib/reports/load";
import { transactionLedgerToCsvRows } from "@/lib/reports/serialize";
import { buildTransactionLedger, parseTransactionTypes } from "@/lib/reports/transactions";
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
  const csv = buildCsvDocument(transactionLedgerToCsvRows(ledger));

  return csvResponse(csv, `veridan-transactions-${range.startIso}-to-${range.endIso}.csv`);
}

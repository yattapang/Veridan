/**
 * GET /api/reports/transactions/export?from=&to=&basis=&type=… — the
 * transaction detail ledger as CSV. Auth-gated.
 *
 * `basis` defaults to accrual, exactly as the on-screen ledger does, and is
 * written into the filename as well as the file body: the two bases date
 * every row differently and total differently, so two downloads of the same
 * period must not collide on disk.
 *
 * `type` may be repeated or comma-joined ("customer_payment,operating_expense");
 * omitting it returns every type, which is the form the accountant normally
 * wants. Invalid values are dropped rather than erroring — a stale bookmark
 * should still produce a usable file.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { parseReportBasis } from "@/lib/reports/basis";
import { buildCsvDocument } from "@/lib/reports/csv";
import { csvResponse, invalidRangeResponse, NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED } from "@/lib/reports/exportHttp";
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
  const csv = buildCsvDocument(transactionLedgerToCsvRows(ledger));

  return csvResponse(csv, `veridan-transactions-${basis}-${range.startIso}-to-${range.endIso}.csv`);
}

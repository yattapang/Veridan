/**
 * GET /api/reports/orders/export?from=&to= — orders + actual costs, raw
 * (Task 56). One row per recorded actual cost with its order/quote context,
 * filtered by incurred_date. Auth-gated. This is the accountant's underlying
 * ledger behind the P&L and margin-audit summaries.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { buildCsvDocument } from "@/lib/reports/csv";
import { csvResponse, NOT_AUTHENTICATED, parseExportRange, SUPABASE_NOT_CONFIGURED } from "@/lib/reports/exportHttp";
import { loadOrdersRawData } from "@/lib/reports/load";
import { ordersRawToCsvRows } from "@/lib/reports/serialize";
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
  const { data, error } = await loadOrdersRawData(supabase, range);
  if (error || !data) {
    return NextResponse.json({ error: error ?? "Could not load report." }, { status: 500 });
  }

  const csv = buildCsvDocument(ordersRawToCsvRows(data, range));
  return csvResponse(csv, `veridan-orders-actuals-${range.startIso}-to-${range.endIso}.csv`);
}

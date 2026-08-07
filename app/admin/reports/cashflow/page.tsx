import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { formatJmd, formatUsd } from "@/lib/quotes/format";
import { describeCurrentFxRate } from "@/lib/expenses/expense";
import { parseReportDateRange, yearToDateRange } from "@/lib/reports/period";
import {
  computeCashFlowByMonth,
  netCashMovementJmd,
  totalCashInJmd,
  totalCashOutByKind,
  totalCashOutJmd,
} from "@/lib/reports/cashflow";
import { buildCashOutEntries, loadFinancialStatementData } from "@/lib/reports/load";
import { DateRangeFilter } from "../DateRangeFilter";
import { ExportLinks } from "../ExportLinks";

export const metadata = {
  title: "Cash Flow Statement",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Cash-flow statement. Previously this page listed receipts only, which made
 * it impossible to answer "did we actually make money this month". It now
 * shows both directions and a running balance.
 *
 * There is no basis toggle here on purpose: a cash-flow statement is cash
 * basis by definition. Only rows carrying a payment date appear.
 */
export default async function CashFlowReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  // A malformed or reversed range falls back to year-to-date rather than
  // being passed through to the query layer.
  const range = parseReportDateRange(firstParam(query.start), firstParam(query.end)) ?? yearToDateRange();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Cash flow</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const { data, error } = await loadFinancialStatementData(supabase, range);
  if (error || !data) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Cash flow</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The report data couldn't be loaded (${error ?? "unknown error"}). Check that migrations are applied and reload.`}
        />
      </div>
    );
  }

  const { entries: outEntries, unconvertedUsd, usedCurrentRateConversion } = buildCashOutEntries(data, range);
  const monthly = computeCashFlowByMonth(data.cashIn, range, outEntries);
  const totalIn = totalCashInJmd(monthly);
  const totalOut = totalCashOutJmd(monthly);
  const net = netCashMovementJmd(monthly);
  const outCostOfSales = totalCashOutByKind(monthly, "cost_of_sales");
  const outOperating = totalCashOutByKind(monthly, "operating_expense");

  return (
    <div className="max-w-6xl">
      <Link
        href="/admin/reports"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← Reports
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-veridan-ink">Cash flow statement</h1>
          <p className="mt-2 max-w-3xl text-sm text-veridan-warm-gray">
            Real money in and out. Cash in is every recorded invoice payment; cash out is every actual cost and
            operating expense that has a payment date recorded against it. Always cash basis — an unpaid bill has
            not moved any money, so it does not appear here.
          </p>
        </div>
        <ExportLinks
          links={[{ label: "Export CSV", href: "/api/reports/cashflow/export" }]}
          startIso={range.startIso}
          endIso={range.endIso}
        />
      </div>

      <div className="mt-6">
        <DateRangeFilter startIso={range.startIso} endIso={range.endIso} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Cash in</p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatJmd(totalIn, 2)}</p>
          <p className="text-xs text-veridan-warm-gray">Customer payments received</p>
        </div>
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Cash out</p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatJmd(totalOut, 2)}</p>
          <p className="text-xs text-veridan-warm-gray">
            {formatJmd(outCostOfSales, 2)} cost of sales · {formatJmd(outOperating, 2)} operating
          </p>
        </div>
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Net movement</p>
          <p
            className={`mt-1 text-lg font-semibold ${net < 0 ? "text-red-700" : "text-veridan-ink"}`}
          >
            {formatJmd(net, 2)}
          </p>
          <p className="text-xs text-veridan-warm-gray">Cumulative for the selected period</p>
        </div>
      </div>

      {unconvertedUsd > 0 && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {formatUsd(unconvertedUsd)} of paid costs and expenses could not be converted to JMD (no FX rate
          available) and is excluded from the outflows above.
        </div>
      )}

      {/* The same disclosure the income statement and the ledger carry.
          Without it a HISTORICAL USD outflow silently changes value whenever
          the founder edits the FX parameter, with nothing on the page saying
          so. Gated on a current-rate conversion actually contributing here. */}
      {usedCurrentRateConversion && (
        <div className="mt-4 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale/50 px-4 py-3 text-xs text-veridan-warm-gray">
          <strong className="text-veridan-ink">FX note.</strong> Some outflows above were recorded in USD only. An
          operating expense is not linked to an order, so there is no quote-locked rate to use — those are
          converted here at the <strong>current</strong> business-parameter rate ({describeCurrentFxRate(data.fx)}),
          read just now. A historical USD outflow&apos;s JMD figure therefore changes if this page is reloaded
          after the rate parameter is updated. Record the JMD amount you were actually billed if you need a figure
          that never moves. USD cost of sales is unaffected: it converts at its own order&apos;s frozen quote rate.
        </div>
      )}

      <div className="mt-4 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale/50 px-4 py-3 text-xs text-veridan-warm-gray">
        <strong className="text-veridan-ink">On the balances below.</strong> Opening and closing figures are
        cumulative movement within the selected period, starting at zero — they are not bank account balances,
        because Veridan does not record an opening bank balance here. Costs recorded before payment dates were
        introduced have no payment date yet, so they will not appear as outflows until one is set.
      </div>

      {/* Monthly summary */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Monthly summary
        </h2>
        <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
          <table className="w-full min-w-[720px] table-auto border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 text-right">Opening</th>
                <th className="px-3 py-2 text-right">Cash in</th>
                <th className="px-3 py-2 text-right">Cash out</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="px-3 py-2 text-right">Closing</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((row) => (
                <tr key={row.monthKey} className="border-b border-veridan-warm-gray-light last:border-b-0">
                  <td className="px-3 py-2 text-veridan-ink">{row.monthKey}</td>
                  <td className="px-3 py-2 text-right text-veridan-warm-gray">
                    {formatJmd(row.openingBalanceJmd, 2)}
                  </td>
                  <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(row.totalInJmd, 2)}</td>
                  <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(row.totalOutJmd, 2)}</td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${
                      row.netJmd < 0 ? "text-red-700" : "text-veridan-ink"
                    }`}
                  >
                    {formatJmd(row.netJmd, 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-veridan-ink">
                    {formatJmd(row.closingBalanceJmd, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per-month detail, both directions */}
      <section className="mt-8 space-y-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">Detail by month</h2>
        {monthly.map((row) => (
          <div key={row.monthKey} className="rounded-md border border-veridan-warm-gray-light bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/40 px-4 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-veridan-ink">{row.monthKey}</h3>
              <span className="text-xs text-veridan-warm-gray">
                In {formatJmd(row.totalInJmd, 2)} · Out {formatJmd(row.totalOutJmd, 2)} ·{" "}
                <span className={row.netJmd < 0 ? "text-red-700" : "text-veridan-ink"}>
                  Net {formatJmd(row.netJmd, 2)}
                </span>
              </span>
            </div>

            <div className="px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">Cash in</p>
              {row.entries.length === 0 ? (
                <p className="mt-1 text-xs text-veridan-warm-gray">No payments recorded.</p>
              ) : (
                <table className="mt-1 w-full min-w-[520px] table-auto border-collapse text-left text-sm">
                  <thead>
                    <tr className="text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                      <th className="py-1 pr-3">Date</th>
                      <th className="py-1 pr-3">Invoice</th>
                      <th className="py-1 pr-3">Quote</th>
                      <th className="py-1 pr-3">Method</th>
                      <th className="py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.entries.map((e, i) => (
                      <tr key={`in-${e.invoiceNumber}-${i}`} className="border-t border-veridan-warm-gray-light">
                        <td className="py-1.5 pr-3 text-veridan-warm-gray">{e.paidAtIso}</td>
                        <td className="py-1.5 pr-3 text-veridan-ink">{e.invoiceNumber}</td>
                        <td className="py-1.5 pr-3 text-veridan-warm-gray">{e.quoteRef}</td>
                        <td className="py-1.5 pr-3 text-veridan-warm-gray">{e.method ?? "—"}</td>
                        <td className="py-1.5 text-right font-medium text-veridan-ink">
                          {formatJmd(e.amountJmd, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border-t border-veridan-warm-gray-light px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">Cash out</p>
              {row.outEntries.length === 0 ? (
                <p className="mt-1 text-xs text-veridan-warm-gray">No payments made.</p>
              ) : (
                <table className="mt-1 w-full min-w-[520px] table-auto border-collapse text-left text-sm">
                  <thead>
                    <tr className="text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                      <th className="py-1 pr-3">Date</th>
                      <th className="py-1 pr-3">Category</th>
                      <th className="py-1 pr-3">Party</th>
                      <th className="py-1 pr-3">Description</th>
                      <th className="py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.outEntries.map((e, i) => (
                      <tr key={`out-${i}`} className="border-t border-veridan-warm-gray-light">
                        <td className="py-1.5 pr-3 text-veridan-warm-gray">{e.paidAtIso}</td>
                        <td className="py-1.5 pr-3 text-veridan-ink">
                          {e.categoryLabel}
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-veridan-warm-gray">
                            {e.kind === "cost_of_sales" ? "COS" : "OPEX"}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-veridan-warm-gray">{e.party ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-veridan-warm-gray">{e.description ?? "—"}</td>
                        <td className="py-1.5 text-right font-medium text-veridan-ink">
                          {formatJmd(e.amountJmd, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

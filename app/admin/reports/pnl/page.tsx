import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { formatJmd, formatPct, formatUsd } from "@/lib/quotes/format";
import { ACTUAL_COST_CATEGORY_LABELS } from "@/lib/orders/format";
import { describeCurrentFxRate } from "@/lib/expenses/expense";
import { parseReportBasis, REPORT_BASIS_LABELS, REPORT_BASIS_SUFFIX } from "@/lib/reports/basis";
import { parseReportDateRange, yearToDateRange } from "@/lib/reports/period";
import { buildIncomeStatement, type IncomeStatementColumn } from "@/lib/reports/incomeStatement";
import { loadFinancialStatementData } from "@/lib/reports/load";
import { BasisToggle } from "../BasisToggle";
import { DateRangeFilter } from "../DateRangeFilter";
import { ExportLinks } from "../ExportLinks";

export const metadata = {
  title: "Income Statement",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function pct(value: number | null): string {
  return value != null ? formatPct(Math.round(value * 10) / 10) : "—";
}

/**
 * Income statement (formerly "P&L").
 *
 *     Revenue − Cost of Sales = Gross Profit − Operating Expenses = Net Profit
 *
 * Presented on ONE basis at a time (accrual by default), with the basis
 * stated in the heading, in the toggle, in every table caption and in every
 * export. No column ever mixes the two.
 *
 * The by-order table is retained — it is genuinely the most useful view
 * Veridan has — but is explicitly scoped as GROSS profit by order, since
 * operating expenses are deliberately not attributed to any order.
 */
export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  // A malformed or reversed range falls back to year-to-date rather than
  // being passed through to the query layer.
  const range = parseReportDateRange(firstParam(query.start), firstParam(query.end)) ?? yearToDateRange();
  const basis = parseReportBasis(query.basis);
  const suffix = REPORT_BASIS_SUFFIX[basis];

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Income statement</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const { data, error: loadError } = await loadFinancialStatementData(supabase, range);
  if (loadError || !data) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Income statement</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The report data couldn't be loaded (${loadError ?? "unknown error"}). Check that migrations are applied and reload.`}
        />
      </div>
    );
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
  const total = statement.total;

  const statementLines: { label: string; value: string; emphasis?: boolean; sub?: string }[] = [
    { label: "Revenue", value: formatJmd(total.revenueJmd, 2) },
    { label: "Less: Cost of sales", value: formatJmd(total.costOfSalesJmd, 2) },
    {
      label: "Gross profit",
      value: formatJmd(total.grossProfitJmd, 2),
      emphasis: true,
      sub: `${pct(total.grossMarginPct)} gross margin`,
    },
    { label: "Less: Operating expenses", value: formatJmd(total.operatingExpensesJmd, 2) },
    {
      label: "Net profit",
      value: formatJmd(total.netProfitJmd, 2),
      emphasis: true,
      sub: `${pct(total.netMarginPct)} net margin`,
    },
  ];

  const monthColumns: IncomeStatementColumn[] = [...statement.months, total];

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
          <h1 className="text-2xl font-semibold text-veridan-ink">
            Income statement <span className="text-veridan-warm-gray">— {REPORT_BASIS_LABELS[basis]} basis</span>
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-veridan-warm-gray">
            Every figure traces to real recorded data — invoices issued, payments received, actual costs and
            operating expenses. Never to a quote&apos;s projected total.
          </p>
        </div>
        <ExportLinks
          links={[{ label: `Export CSV (${REPORT_BASIS_LABELS[basis].toLowerCase()})`, href: "/api/reports/pnl/export" }]}
          startIso={range.startIso}
          endIso={range.endIso}
          extraQuery={{ basis }}
        />
      </div>

      <div className="mt-6">
        <DateRangeFilter startIso={range.startIso} endIso={range.endIso} preserve={{ basis }} />
      </div>

      <BasisToggle basis={basis} startIso={range.startIso} endIso={range.endIso} />

      {/* The statement itself */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Period total · {suffix}
        </h2>
        <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
          <table className="w-full min-w-[420px] table-auto border-collapse text-left text-sm">
            <tbody>
              {statementLines.map((line) => (
                <tr
                  key={line.label}
                  className={`border-b border-veridan-warm-gray-light last:border-b-0 ${
                    line.emphasis ? "bg-veridan-warm-gray-pale/40" : ""
                  }`}
                >
                  <td className={`px-4 py-2.5 ${line.emphasis ? "font-semibold text-veridan-ink" : "text-veridan-ink"}`}>
                    {line.label}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right ${
                      line.emphasis ? "font-semibold text-veridan-ink" : "text-veridan-ink"
                    }`}
                  >
                    {line.value}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-veridan-warm-gray">{line.sub ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* MEMO, deliberately outside the statement block above. GCT is money
          held for the government, not income — so it is reported where it can
          be reconciled against a GCT return, and nowhere near a margin. */}
      <section className="mt-4">
        <div className="rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale/50 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
              Memo · GCT collected ({suffix})
            </p>
            <p className="text-sm font-semibold text-veridan-ink">{formatJmd(statement.gctCollectedJmd, 2)}</p>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-veridan-warm-gray">
            <strong className="text-veridan-ink">Not revenue.</strong> GCT is collected on the government&apos;s
            behalf and is a liability, so it is excluded from Revenue, Gross profit and Net profit above.{" "}
            {basis === "accrual"
              ? "Accrual basis: GCT billed on the invoices issued in this period."
              : "Cash basis: the GCT share of the payments received in this period, pro-rated against each invoice."}
          </p>
        </div>
      </section>

      {(statement.unconvertedCostOfSalesUsd > 0 || statement.unconvertedOperatingExpensesUsd > 0) && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {formatUsd(statement.unconvertedCostOfSalesUsd + statement.unconvertedOperatingExpensesUsd)} could not be
          converted to JMD (no FX rate available) and is excluded from every figure above — cost of sales{" "}
          {formatUsd(statement.unconvertedCostOfSalesUsd)}, operating expenses{" "}
          {formatUsd(statement.unconvertedOperatingExpensesUsd)}.
        </div>
      )}

      {statement.usedCurrentRateConversion && (
        <div className="mt-4 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale/50 px-4 py-3 text-xs text-veridan-warm-gray">
          <strong className="text-veridan-ink">FX note.</strong> Some operating expenses were recorded in USD
          only. Expenses are not linked to an order, so there is no quote-locked rate to use — they are converted
          here at the <strong>current</strong> business-parameter rate ({describeCurrentFxRate(data.fx)}), read
          just now. That means a USD-only expense&apos;s JMD figure can change if this page is reloaded after the
          rate parameter is updated. Record the JMD amount you were actually billed if you need a figure that
          never moves. Cost of sales is unaffected: it converts at each order&apos;s own frozen quote rate.
        </div>
      )}

      {basis === "cash" && (
        <div className="mt-4 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale/50 px-4 py-3 text-xs text-veridan-warm-gray">
          <strong className="text-veridan-ink">Cash basis.</strong> Costs and expenses appear here only once a
          payment date has been recorded against them. Anything still marked unpaid is excluded — so if this
          looks lower than you expect, check for unpaid rows on the{" "}
          <Link href="/admin/expenses?payment=unpaid" className="underline underline-offset-2 hover:text-veridan-ink">
            expenses list
          </Link>{" "}
          and on each order&apos;s actual costs. Actual costs recorded before payment dates were introduced have no
          payment date yet and will not appear until one is set.
        </div>
      )}

      {/* By month */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          By month · {suffix}
        </h2>
        <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
          <table className="w-full min-w-[820px] table-auto border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">Cost of sales</th>
                <th className="px-3 py-2 text-right">Gross profit</th>
                <th className="px-3 py-2 text-right">GM%</th>
                <th className="px-3 py-2 text-right">Operating expenses</th>
                <th className="px-3 py-2 text-right">Net profit</th>
                <th className="px-3 py-2 text-right">NM%</th>
              </tr>
            </thead>
            <tbody>
              {monthColumns.map((c) => {
                const isTotal = c.key === "total";
                return (
                  <tr
                    key={c.key}
                    className={`border-b border-veridan-warm-gray-light last:border-b-0 ${
                      isTotal ? "bg-veridan-warm-gray-pale/40 font-semibold" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-veridan-ink">{c.label}</td>
                    <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(c.revenueJmd, 2)}</td>
                    <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(c.costOfSalesJmd, 2)}</td>
                    <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(c.grossProfitJmd, 2)}</td>
                    <td className="px-3 py-2 text-right text-veridan-warm-gray">{pct(c.grossMarginPct)}</td>
                    <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(c.operatingExpensesJmd, 2)}</td>
                    <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(c.netProfitJmd, 2)}</td>
                    <td className="px-3 py-2 text-right text-veridan-warm-gray">{pct(c.netMarginPct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cost of sales by category */}
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Cost of sales by category
          </h2>
          {statement.costOfSalesByCategory.length === 0 ? (
            <InstructiveMessage
              title="No cost of sales in this range"
              body="Actual costs recorded against an order, dated within this range on the selected basis, appear here broken out by category."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
              <table className="w-full table-auto border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.costOfSalesByCategory.map(([category, amount]) => (
                    <tr key={category} className="border-b border-veridan-warm-gray-light last:border-b-0">
                      <td className="px-3 py-2 text-veridan-ink">{ACTUAL_COST_CATEGORY_LABELS[category]}</td>
                      <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(amount, 2)}</td>
                      <td className="px-3 py-2 text-right text-veridan-warm-gray">
                        {total.costOfSalesJmd > 0
                          ? formatPct(Math.round((amount / total.costOfSalesJmd) * 1000) / 10)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Operating expenses by category
          </h2>
          {statement.operatingExpensesByCategory.length === 0 ? (
            <InstructiveMessage
              title="No operating expenses in this range"
              body="Record rent, salaries, professional fees and the like under Expenses, and they will appear here."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
              <table className="w-full table-auto border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.operatingExpensesByCategory.map((cat) => (
                    <tr key={cat.categoryName} className="border-b border-veridan-warm-gray-light last:border-b-0">
                      <td className="px-3 py-2 text-veridan-ink">{cat.categoryLabel}</td>
                      <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(cat.amountJmd, 2)}</td>
                      <td className="px-3 py-2 text-right text-veridan-warm-gray">
                        {total.operatingExpensesJmd > 0
                          ? formatPct(Math.round((cat.amountJmd / total.operatingExpensesJmd) * 1000) / 10)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Gross profit by order */}
      <section className="mt-8">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Gross profit by order · {suffix}
        </h2>
        <p className="mb-3 max-w-3xl text-xs text-veridan-warm-gray">
          Gross profit only — operating expenses are <strong>not</strong> allocated to orders. Rent is not a cost
          of any one shipment, and splitting it across orders would turn a measured figure into an assumption.
          Net profit exists at period level only. Every in-range cost appears here: an order whose revenue falls
          outside this period shows zero revenue and a negative gross profit, so the cost of sales column always
          sums to the cost of sales line above.
        </p>
        {statement.grossProfitByOrder.length === 0 ? (
          <InstructiveMessage
            title="No order-attributed activity in this range"
            body="Nothing in this period is linked to an order yet. Revenue whose quote has no order created still counts in the totals above but has no row here; costs are always order-linked, so any in-range cost of sales would appear."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[720px] table-auto border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Cost of sales</th>
                  <th className="px-3 py-2 text-right">Gross profit</th>
                  <th className="px-3 py-2 text-right">Gross margin</th>
                </tr>
              </thead>
              <tbody>
                {statement.grossProfitByOrder.map((row) => (
                  <tr key={row.orderId} className="border-b border-veridan-warm-gray-light last:border-b-0">
                    <td className="px-3 py-2 text-veridan-ink">
                      <Link
                        href={`/admin/orders/${row.orderId}`}
                        className="underline underline-offset-2 hover:text-veridan-accent"
                      >
                        {row.quoteRef}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(row.revenueJmd, 2)}</td>
                    <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(row.costJmd, 2)}</td>
                    <td className="px-3 py-2 text-right font-medium text-veridan-ink">
                      {formatJmd(row.grossProfitJmd, 2)}
                    </td>
                    <td className="px-3 py-2 text-right text-veridan-ink">{pct(row.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

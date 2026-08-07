import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { formatJmd, formatUsd } from "@/lib/quotes/format";
import { describeCurrentFxRate } from "@/lib/expenses/expense";
import { parseReportBasis, REPORT_BASIS_LABELS, REPORT_BASIS_SUFFIX } from "@/lib/reports/basis";
import { parseReportDateRange, yearToDateRange } from "@/lib/reports/period";
import { loadFinancialStatementData } from "@/lib/reports/load";
import {
  buildTransactionLedger,
  parseTransactionTypes,
  TRANSACTION_DIRECTION,
  TRANSACTION_FX_BASIS_LABELS,
  TRANSACTION_TYPE_LABELS,
  type TransactionRow,
} from "@/lib/reports/transactions";
import { BasisToggle } from "../BasisToggle";
import { DateRangeFilter } from "../DateRangeFilter";
import { ExportLinks } from "../ExportLinks";
import { TypeFilter } from "./TypeFilter";

export const metadata = {
  title: "Transaction Detail",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Money in reads neutral; money out is tinted so the direction is visible without reading the type column. */
function amountClass(row: TransactionRow): string {
  return row.type === "customer_payment" || row.type === "invoice_issued" ? "text-veridan-ink" : "text-red-700";
}

/**
 * Transaction detail — the accountant's report.
 *
 * One chronological listing of every recorded financial transaction in the
 * range, with enough context per row to be posted in external accounting
 * software without a follow-up question. This is what the founder meant by
 * "detailed transaction reports for the accountant"; it is not a
 * double-entry journal, and deliberately so.
 *
 * IT IS BASIS-AWARE, and carries the same accrual/cash toggle the income
 * statement does. This is a RECONCILIATION document: on either basis its
 * Money in / Money out / Net tie out exactly to that statement's Revenue,
 * (Cost of sales + Operating expenses) and Net profit for the same period.
 * A ledger that dated revenue on one basis and costs on another reconciled
 * to neither.
 */
export default async function TransactionDetailPage({
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
  const types = parseTransactionTypes(query.type);

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Transaction detail</h1>
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
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Transaction detail</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The report data couldn't be loaded (${error ?? "unknown error"}). Check that migrations are applied and reload.`}
        />
      </div>
    );
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

  const usedCurrentRate = ledger.rows.some((r) => r.fxBasis === "current_rate");

  return (
    <div className="max-w-7xl">
      <Link
        href="/admin/reports"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← Reports
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-veridan-ink">
            Transaction detail{" "}
            <span className="text-veridan-warm-gray">— {REPORT_BASIS_LABELS[basis]} basis</span>
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-veridan-warm-gray">
            Every financial transaction recorded in the period, in one chronological listing, dated on the{" "}
            {suffix}. This is the report to hand the accountant, and it <strong>reconciles</strong> to the income
            statement for the same period and basis: money in equals its Revenue line, money out equals cost of
            sales plus operating expenses. Both the incurred and paid dates travel on every row.
          </p>
        </div>
        <ExportLinks
          links={[
            {
              label: `Export CSV (${REPORT_BASIS_LABELS[basis].toLowerCase()})`,
              href: "/api/reports/transactions/export",
            },
            {
              label: `Export Excel (${REPORT_BASIS_LABELS[basis].toLowerCase()})`,
              href: "/api/reports/transactions/export-xlsx",
            },
          ]}
          startIso={range.startIso}
          endIso={range.endIso}
          extraQuery={{ basis, type: types }}
        />
      </div>

      <div className="mt-6">
        <DateRangeFilter startIso={range.startIso} endIso={range.endIso} preserve={{ basis, type: types }} />
      </div>

      <div className="mb-6">
        <BasisToggle
          basis={basis}
          startIso={range.startIso}
          endIso={range.endIso}
          basePath="/admin/reports/transactions"
          preserve={{ type: types }}
        />
      </div>

      <TypeFilter selected={types} basis={basis} startIso={range.startIso} endIso={range.endIso} />

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Transactions</p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{ledger.rows.length}</p>
        </div>
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
            Money in ({suffix})
          </p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatJmd(ledger.totalInJmd, 2)}</p>
          <p className="text-xs text-veridan-warm-gray">
            {basis === "accrual" ? "Invoices issued" : "Payments received"}, net of GCT
          </p>
        </div>
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
            Money out ({suffix})
          </p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatJmd(ledger.totalOutJmd, 2)}</p>
          <p className="text-xs text-veridan-warm-gray">Cost of sales + operating expenses</p>
        </div>
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Net ({suffix})</p>
          <p
            className={`mt-1 text-lg font-semibold ${ledger.netJmd < 0 ? "text-red-700" : "text-veridan-ink"}`}
          >
            {formatJmd(ledger.netJmd, 2)}
          </p>
          <p className="text-xs text-veridan-warm-gray">Equals net profit on this basis</p>
        </div>
      </div>

      {ledger.gctCollectedJmd !== 0 && (
        <div className="mt-4 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale/50 px-4 py-3 text-xs text-veridan-warm-gray">
          <strong className="text-veridan-ink">GCT — memo, not revenue.</strong>{" "}
          {formatJmd(ledger.gctCollectedJmd, 2)} of GCT is included in the &ldquo;JMD&rdquo; column of the money-in
          rows below and is <strong>excluded</strong> from Money in, Net, and every figure on the income statement.
          It is collected on the government&apos;s behalf and is a liability, never income.
        </div>
      )}

      {ledger.unresolvedRowCount > 0 && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {ledger.unresolvedRowCount} transaction{ledger.unresolvedRowCount === 1 ? "" : "s"} totalling{" "}
          {formatUsd(ledger.unresolvedUsd)} could not be converted to JMD (no FX rate available) and{" "}
          {ledger.unresolvedRowCount === 1 ? "is" : "are"} excluded from the totals above. They are still listed
          below, marked &ldquo;not converted&rdquo;.
        </div>
      )}

      {usedCurrentRate && (
        <div className="mt-4 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale/50 px-4 py-3 text-xs text-veridan-warm-gray">
          <strong className="text-veridan-ink">FX note.</strong> USD-only operating expenses are converted at the
          current business-parameter rate ({describeCurrentFxRate(data.fx)}), because an expense is not linked to
          an order and so has no quote-locked rate. USD-only cost of sales converts at its own order&apos;s frozen
          quote rate. Every row states which applied in its FX basis column, and the &ldquo;as recorded&rdquo;
          columns are always the untouched original figures.
        </div>
      )}

      <section className="mt-8">
        {ledger.rows.length === 0 ? (
          <InstructiveMessage
            title="No transactions in this range"
            body={
              basis === "cash"
                ? "Widen the date range, or clear the type filter, to see more. On the cash basis only rows with a recorded payment date appear — try the accrual basis if you expect unpaid bills or unsettled invoices here."
                : "Widen the date range, or clear the type filter, to see more."
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[1100px] table-auto border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Party</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">JMD</th>
                  <th className="px-3 py-2 text-right">USD</th>
                  <th className="px-3 py-2 text-right">GCT</th>
                  <th className="px-3 py-2 text-right">JMD total</th>
                  <th className="px-3 py-2">Incurred</th>
                  <th className="px-3 py-2">Paid</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((r, i) => (
                  <tr
                    key={`${r.dateIso}-${r.type}-${i}`}
                    className="border-b border-veridan-warm-gray-light last:border-b-0"
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-veridan-warm-gray">{r.dateIso}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-veridan-ink">
                      {TRANSACTION_TYPE_LABELS[r.type]}
                    </td>
                    <td className="px-3 py-2 text-veridan-warm-gray">{r.reference ?? "—"}</td>
                    <td className="px-3 py-2 text-veridan-warm-gray">{r.party ?? "—"}</td>
                    <td className="px-3 py-2 text-veridan-warm-gray">{r.category}</td>
                    <td className="px-3 py-2 text-veridan-ink">{r.description ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-veridan-warm-gray">
                      {r.amountJmd != null ? formatJmd(r.amountJmd, 2) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-veridan-warm-gray">
                      {r.amountUsd != null ? formatUsd(r.amountUsd) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-veridan-warm-gray">
                      {r.gctJmd !== 0 ? formatJmd(r.gctJmd, 2) : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${amountClass(r)}`}>
                      {r.resolvedJmd != null ? (
                        <span title={TRANSACTION_FX_BASIS_LABELS[r.fxBasis]}>
                          {TRANSACTION_DIRECTION[r.type] === 1 ? "" : "−"}
                          {formatJmd(r.resolvedJmd, 2)}
                        </span>
                      ) : (
                        <span className="text-amber-700">not converted</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-veridan-warm-gray">
                      {r.incurredDateIso ?? "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-veridan-warm-gray">
                      {r.paidDateIso ?? <span className="text-amber-700">unpaid</span>}
                    </td>
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

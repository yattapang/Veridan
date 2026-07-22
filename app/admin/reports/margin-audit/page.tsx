import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { formatPct, formatUsd } from "@/lib/quotes/format";
import { ORDER_STATUS_LABELS } from "@/lib/orders/format";
import { yearToDateRange, type ReportDateRange } from "@/lib/reports/period";
import { loadMarginAuditData } from "@/lib/reports/load";
import { buildMarginAudit, VARIANCE_CATEGORY_LABELS } from "@/lib/reports/marginAudit";
import { DateRangeFilter } from "../DateRangeFilter";
import { ExportLinks } from "../ExportLinks";

export const metadata = {
  title: "Margin Audit Report",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function pct1(value: number | null): string {
  return value == null ? "—" : formatPct(Math.round(value * 10) / 10);
}

export default async function MarginAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const startParam = firstParam(query.start).trim();
  const endParam = firstParam(query.end).trim();
  const defaultRange = yearToDateRange();
  const range: ReportDateRange = {
    startIso: startParam || defaultRange.startIso,
    endIso: endParam || defaultRange.endIso,
  };

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Margin audit</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const { data, error } = await loadMarginAuditData(supabase, range);
  if (error || !data) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Margin audit</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The report data couldn't be loaded (${error ?? "unknown error"}). Check that migrations are applied and reload.`}
        />
      </div>
    );
  }

  const { rows, rollup } = buildMarginAudit(data.orders, data.costs, data.payments, data.invoices);

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
          <h1 className="text-2xl font-semibold text-veridan-ink">Margin audit</h1>
          <p className="mt-2 max-w-3xl text-sm text-veridan-warm-gray">
            Quoted projection vs. actual cost vs. realized (cash-basis) margin, per order. Quoted figures here are the
            baseline being audited — the only report where a quote&apos;s own numbers appear as values, clearly labeled.
            Realized margin is <span className="font-medium">(payments received − actual costs) ÷ payments received</span>;
            while an order is still in flight, a projected-realized figure (expected full revenue vs. costs so far) is
            used for the floor check and the row is marked provisional.
          </p>
        </div>
        <ExportLinks
          links={[
            { label: "Export CSV", href: "/api/reports/margin-audit/export" },
            { label: "Export Excel", href: "/api/reports/margin-audit/export-xlsx" },
          ]}
          startIso={range.startIso}
          endIso={range.endIso}
        />
      </div>

      <div className="mt-6">
        <DateRangeFilter startIso={range.startIso} endIso={range.endIso} />
      </div>

      {rollup.flaggedCount > 0 && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-5 py-4">
          <p className="text-sm font-semibold text-red-800">
            {rollup.flaggedCount} order{rollup.flaggedCount === 1 ? "" : "s"} below the margin floor
          </p>
          <p className="mt-1 text-sm text-red-700">
            The order{rollup.flaggedCount === 1 ? "'s" : "s'"} realized (or projected-realized) margin has drifted below
            the floor snapshotted on its quote. These are the PRD §8 early-warning cases — review the flagged rows
            first.
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <InstructiveMessage
          title="No orders in this range"
          body="Create an order from an accepted quote (and record its actual costs) to see a quoted-vs-actual-vs-realized comparison here. The range filters orders by creation date."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Orders</p>
              <p className="mt-1 text-lg font-semibold text-veridan-ink">{rollup.orderCount}</p>
            </div>
            <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Flagged</p>
              <p className={`mt-1 text-lg font-semibold ${rollup.flaggedCount > 0 ? "text-red-700" : "text-veridan-ink"}`}>
                {rollup.flaggedCount}
              </p>
            </div>
            <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Cost variance</p>
              <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatUsd(rollup.totalCostVarianceUsd)}</p>
              <p className="text-xs text-veridan-warm-gray">actual − quoted landed (USD)</p>
            </div>
            <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Portfolio realized</p>
              <p className="mt-1 text-lg font-semibold text-veridan-ink">{pct1(rollup.realizedMarginPct)}</p>
              <p className="text-xs text-veridan-warm-gray">cash-basis margin</p>
            </div>
          </div>

          {/* Per-order */}
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">By order</h2>
            <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
              <table className="w-full min-w-[900px] table-auto border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                    <th className="px-3 py-2">Order</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Quoted margin</th>
                    <th className="px-3 py-2 text-right">Quoted landed (USD)</th>
                    <th className="px-3 py-2 text-right">Actual cost (USD)</th>
                    <th className="px-3 py-2 text-right">Cost variance</th>
                    <th className="px-3 py-2 text-right">Realized margin</th>
                    <th className="px-3 py-2 text-right">Floor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.orderId}
                      className={`border-b border-veridan-warm-gray-light last:border-b-0 ${row.floorDrift ? "bg-red-50" : ""}`}
                    >
                      <td className="px-3 py-2 text-veridan-ink">
                        <Link
                          href={`/admin/orders/${row.orderId}`}
                          className="underline underline-offset-2 hover:text-veridan-accent"
                        >
                          {row.quoteRef}
                        </Link>
                        {row.floorDrift && (
                          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                            Floor
                          </span>
                        )}
                        {row.completenessNote && (
                          <p className="mt-0.5 max-w-[240px] text-[11px] text-veridan-warm-gray">{row.completenessNote}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-veridan-warm-gray">{ORDER_STATUS_LABELS[row.orderStatus]}</td>
                      <td className="px-3 py-2 text-right text-veridan-warm-gray">{pct1(row.quotedMarginPct)}</td>
                      <td className="px-3 py-2 text-right text-veridan-ink">{formatUsd(row.quotedLandedUsd)}</td>
                      <td className="px-3 py-2 text-right text-veridan-ink">{formatUsd(row.actualCostUsd)}</td>
                      <td
                        className={`px-3 py-2 text-right ${
                          row.totalCostVarianceUsd != null && row.totalCostVarianceUsd > 0
                            ? "text-red-700"
                            : "text-veridan-ink"
                        }`}
                      >
                        {formatUsd(row.totalCostVarianceUsd)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${row.floorDrift ? "text-red-700" : "text-veridan-ink"}`}
                      >
                        {pct1(row.marginForFloorCheckPct)}
                        {!row.isComplete && <span className="ml-1 text-[10px] text-veridan-warm-gray">(proj.)</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-veridan-warm-gray">{pct1(row.marginFloorPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-veridan-warm-gray">
              Realized margin uses actual cash received when an order is complete (fully paid and closed), and a
              projected-realized figure (marked &ldquo;proj.&rdquo;) while it is still in flight. Costs recorded in JMD
              are converted to USD for the cost columns at each order&apos;s own quote-locked FX rate.
            </p>
          </section>

          {/* Category variance rollup */}
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
              Cost variance by category (all orders, USD)
            </h2>
            <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
              <table className="w-full min-w-[520px] table-auto border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">Quoted</th>
                    <th className="px-3 py-2 text-right">Actual</th>
                    <th className="px-3 py-2 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {rollup.categories.map((c) => (
                    <tr key={c.category} className="border-b border-veridan-warm-gray-light last:border-b-0">
                      <td className="px-3 py-2 text-veridan-ink">{VARIANCE_CATEGORY_LABELS[c.category]}</td>
                      <td className="px-3 py-2 text-right text-veridan-warm-gray">{formatUsd(c.quotedUsd)}</td>
                      <td className="px-3 py-2 text-right text-veridan-ink">{formatUsd(c.actualUsd)}</td>
                      <td
                        className={`px-3 py-2 text-right font-medium ${c.varianceUsd > 0 ? "text-red-700" : "text-veridan-ink"}`}
                      >
                        {formatUsd(c.varianceUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-veridan-warm-gray">
              Quoted components come from each quote&apos;s origin cost pools (hardware = supplier invoice; brokerage +
              port merged). Actual delivery/other costs have no quoted equivalent and are excluded from these category
              rows (they still count in each order&apos;s total actual cost and realized margin).
            </p>
          </section>

          <p className="mt-8 flex items-center gap-2 text-xs text-veridan-warm-gray">
            <span>Formatted for the accountant:</span>
            <ExportLinks
              links={[
                { label: "CSV", href: "/api/reports/margin-audit/export" },
                { label: "Excel", href: "/api/reports/margin-audit/export-xlsx" },
                { label: "Orders + actuals (raw CSV)", href: "/api/reports/orders/export" },
              ]}
              startIso={range.startIso}
              endIso={range.endIso}
            />
          </p>
        </>
      )}
    </div>
  );
}

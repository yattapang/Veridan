import Link from "next/link";

export const metadata = {
  title: "Reports",
};

/**
 * Reports hub (Task 54). Both linked reports read exclusively from
 * `invoice_payments` (real cash received) and `actual_costs` (real money
 * spent) — never from `quotes`/`quote_line_items` projections. See
 * lib/reports/pnl.ts and lib/reports/cashflow.ts headers for the full rule.
 */
export default function ReportsHubPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Reports</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Every figure below traces to real invoice payments and recorded actual costs — never to a quote&apos;s
        projected total. Quote/invoice references shown alongside a total are always labels or links, not inputs to
        the sum.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/reports/pnl"
          className="block rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5 transition-opacity duration-150 hover:opacity-80"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">Profit &amp; loss</h2>
          <p className="mt-2 text-sm text-veridan-warm-gray">
            Cash-basis revenue (payments received) vs. actual costs, per month and per order, with gross profit and
            margin %.
          </p>
        </Link>
        <Link
          href="/admin/reports/cashflow"
          className="block rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5 transition-opacity duration-150 hover:opacity-80"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">Cash flow</h2>
          <p className="mt-2 text-sm text-veridan-warm-gray">
            Monthly cash received, broken out per payment with its invoice and quote reference.
          </p>
        </Link>
      </div>

      <div className="mt-8 rounded-md border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-sm font-medium text-amber-800">Exports not yet available</p>
        <p className="mt-1 text-sm text-amber-800">
          Excel/PDF/CSV export (Task 56) has not been built yet — use the on-screen tables for now.
        </p>
      </div>
    </div>
  );
}

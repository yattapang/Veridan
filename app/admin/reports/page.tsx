import Link from "next/link";

export const metadata = {
  title: "Reports",
};

/**
 * Reports hub (Tasks 54–56). P&L and cash flow read exclusively from
 * `invoice_payments` (real cash received) and `actual_costs` (real money
 * spent) — never from `quotes`/`quote_line_items` projections. The margin
 * audit is the deliberate exception: it compares each quote's projection
 * against those same real actuals/payments, so its quoted figures appear as
 * the labeled baseline being audited (see lib/reports/marginAudit.ts).
 */
export default function ReportsHubPage() {
  const cards = [
    {
      href: "/admin/reports/pnl",
      title: "Profit & loss",
      body: "Cash-basis revenue (payments received) vs. actual costs, per month and per order, with gross profit and margin %.",
    },
    {
      href: "/admin/reports/cashflow",
      title: "Cash flow",
      body: "Monthly cash received, broken out per payment with its invoice and quote reference.",
    },
    {
      href: "/admin/reports/margin-audit",
      title: "Margin audit",
      body: "Quoted vs. actual vs. realized margin per order, with per-category cost variances and a red flag on any order that drifted below its quote's margin floor.",
    },
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Reports</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        P&amp;L and cash flow trace every figure to real invoice payments and recorded actual costs — never to a
        quote&apos;s projected total. The margin audit is the one report that compares the quote against reality, so its
        quoted figures are shown as the labeled baseline being audited.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="block rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5 transition-opacity duration-150 hover:opacity-80"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">{card.title}</h2>
            <p className="mt-2 text-sm text-veridan-warm-gray">{card.body}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-4">
        <p className="text-sm font-medium text-veridan-ink">Exports for the accountant</p>
        <p className="mt-1 text-sm text-veridan-warm-gray">
          Every report has a CSV download on its own page (from the header buttons). The margin audit additionally
          offers a multi-sheet Excel workbook, and a raw &ldquo;orders + actual costs&rdquo; CSV is available for the
          underlying ledger. All exports honor the date range selected on the report.
        </p>
      </div>
    </div>
  );
}

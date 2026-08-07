import Link from "next/link";

export const metadata = {
  title: "Reports",
};

/**
 * Reports hub (Tasks 54–56; restructured into proper financial statements
 * 2026-08-07). Every figure across these reports reads from real recorded
 * data — `invoices` issued, `invoice_payments` received, `actual_costs`
 * spent, and `expenses` — never from `quotes`/`quote_line_items`
 * projections. The margin audit is the deliberate exception: it compares
 * each quote's projection against those same real actuals/payments, so its
 * quoted figures appear as the labeled baseline being audited (see
 * lib/reports/marginAudit.ts).
 */
export default function ReportsHubPage() {
  const cards = [
    {
      href: "/admin/reports/pnl",
      title: "Income statement",
      body: "Revenue − cost of sales = gross profit − operating expenses = net profit, per month and for the period. Switchable between accrual (default) and cash basis, with gross profit per order alongside.",
    },
    {
      href: "/admin/reports/cashflow",
      title: "Cash flow statement",
      body: "Real cash in and out: customer payments received against costs and operating expenses actually paid, with net movement and a running balance per month.",
    },
    {
      href: "/admin/reports/transactions",
      title: "Transaction detail",
      body: "The accountant's report — every recorded transaction in one chronological ledger, with references, parties, categories and both dates. CSV and Excel.",
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
        Every figure traces to real invoices, payments, actual costs and operating expenses — never to a
        quote&apos;s projected total. The margin audit is the one report that compares the quote against reality,
        so its quoted figures are shown as the labeled baseline being audited.
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
        <p className="text-sm font-medium text-veridan-ink">Accrual or cash?</p>
        <p className="mt-1 text-sm text-veridan-warm-gray">
          The income statement carries a basis toggle and states its basis on every table and export.{" "}
          <strong>Accrual</strong> counts invoices issued and bills incurred, whether or not money has moved —
          the default, and what an accountant normally expects.{" "}
          <strong>Cash</strong> counts only payments received and bills actually paid. The cash-flow statement is
          cash basis by definition and has no toggle. Nothing ever mixes the two in one column.
        </p>
      </div>

      <div className="mt-4 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-4">
        <p className="text-sm font-medium text-veridan-ink">Exports for the accountant</p>
        <p className="mt-1 text-sm text-veridan-warm-gray">
          Every report has a CSV download on its own page. Transaction detail and the margin audit additionally
          offer multi-sheet Excel workbooks, and a raw &ldquo;orders + actual costs&rdquo; CSV is available for
          the underlying cost rows. All exports honor the date range — and the basis — selected on the report.
        </p>
      </div>
    </div>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { formatJmd } from "@/lib/quotes/format";
import { yearToDateRange, type ReportDateRange } from "@/lib/reports/period";
import { computeCashFlowByMonth, totalCashInJmd, type CashInEntry } from "@/lib/reports/cashflow";
import type { InvoiceType } from "@/lib/supabase/types";
import { DateRangeFilter } from "../DateRangeFilter";

export const metadata = {
  title: "Cash Flow Report",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

interface PaymentJoinRow {
  amount_jmd: number;
  paid_at: string;
  method: string | null;
  reference: string | null;
  invoices: {
    invoice_number: string;
    invoice_type: InvoiceType;
    quotes: { quote_ref: string } | null;
  } | null;
}

export default async function CashFlowReportPage({
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
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Cash flow</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const { data, error } = await supabase
    .from("invoice_payments")
    .select("amount_jmd, paid_at, method, reference, invoices(invoice_number, invoice_type, quotes(quote_ref))")
    .gte("paid_at", range.startIso)
    .lte("paid_at", range.endIso);

  if (error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Cash flow</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The report data couldn't be loaded (${error.message}). Check that migrations are applied and reload.`}
        />
      </div>
    );
  }

  const entries: CashInEntry[] = ((data as unknown as PaymentJoinRow[]) ?? []).map((p) => ({
    amountJmd: p.amount_jmd,
    paidAtIso: p.paid_at,
    invoiceNumber: p.invoices?.invoice_number ?? "—",
    invoiceType: p.invoices?.invoice_type ?? "deposit",
    quoteRef: p.invoices?.quotes?.quote_ref ?? "—",
    method: p.method,
    reference: p.reference,
  }));

  const monthly = computeCashFlowByMonth(entries, range);
  const total = totalCashInJmd(monthly);

  return (
    <div className="max-w-5xl">
      <Link
        href="/admin/reports"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← Reports
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-veridan-ink">Cash flow</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Cash in — every recorded invoice payment, never a quote&apos;s projected total. Invoice/quote references are
        shown as labels only.
      </p>

      <div className="mt-6">
        <DateRangeFilter startIso={range.startIso} endIso={range.endIso} />
      </div>

      <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Total cash in</p>
        <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatJmd(total, 2)}</p>
      </div>

      <section className="mt-8 space-y-6">
        {monthly.map((row) => (
          <div key={row.monthKey} className="rounded-md border border-veridan-warm-gray-light bg-white">
            <div className="flex items-center justify-between border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/40 px-4 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-veridan-ink">{row.monthKey}</h2>
              <span className="text-sm font-medium text-veridan-ink">{formatJmd(row.totalInJmd, 2)}</span>
            </div>
            {row.entries.length === 0 ? (
              <p className="px-4 py-3 text-xs text-veridan-warm-gray">No payments recorded.</p>
            ) : (
              <table className="w-full min-w-[560px] table-auto border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-veridan-warm-gray-light text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Invoice</th>
                    <th className="px-4 py-2">Quote</th>
                    <th className="px-4 py-2">Method</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {row.entries.map((e, i) => (
                    <tr key={`${e.invoiceNumber}-${i}`} className="border-b border-veridan-warm-gray-light last:border-b-0">
                      <td className="px-4 py-2 text-veridan-warm-gray">{e.paidAtIso}</td>
                      <td className="px-4 py-2 text-veridan-ink">{e.invoiceNumber}</td>
                      <td className="px-4 py-2 text-veridan-warm-gray">{e.quoteRef}</td>
                      <td className="px-4 py-2 text-veridan-warm-gray">{e.method ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-medium text-veridan-ink">{formatJmd(e.amountJmd, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

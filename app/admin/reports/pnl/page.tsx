import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { formatJmd, formatPct, formatUsd } from "@/lib/quotes/format";
import { yearToDateRange, type ReportDateRange } from "@/lib/reports/period";
import { computePnlByMonth, computePnlByOrder, type OrderRateLookup, type PnlCostInput, type PnlPaymentInput } from "@/lib/reports/pnl";
import type { ActualCostCategory } from "@/lib/supabase/types";
import { DateRangeFilter } from "../DateRangeFilter";

export const metadata = {
  title: "P&L Report",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

interface PaymentJoinRow {
  amount_jmd: number;
  paid_at: string;
  invoices: {
    invoice_number: string;
    quote_id: string;
    quotes: { quote_ref: string } | null;
  } | null;
}

interface CostJoinRow {
  order_id: string;
  category: ActualCostCategory;
  amount_usd: number | null;
  amount_jmd: number | null;
  incurred_date: string;
}

interface OrderJoinRow {
  id: string;
  quote_id: string;
  quotes: { fx_snapshot: { effective_rate: number } } | null;
}

export default async function PnlReportPage({
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
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">P&amp;L</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const [paymentsResult, costsResult, ordersResult] = await Promise.all([
    supabase
      .from("invoice_payments")
      .select("amount_jmd, paid_at, invoices(invoice_number, quote_id, quotes(quote_ref))")
      .gte("paid_at", range.startIso)
      .lte("paid_at", range.endIso),
    supabase
      .from("actual_costs")
      .select("order_id, category, amount_usd, amount_jmd, incurred_date")
      .gte("incurred_date", range.startIso)
      .lte("incurred_date", range.endIso),
    supabase.from("orders").select("id, quote_id, quotes(fx_snapshot)"),
  ]);

  const loadError = paymentsResult.error ?? costsResult.error ?? ordersResult.error;
  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">P&amp;L</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The report data couldn't be loaded (${loadError.message}). Check that migrations are applied and reload.`}
        />
      </div>
    );
  }

  const orders = (ordersResult.data as unknown as OrderJoinRow[]) ?? [];
  const quoteIdToOrderId = new Map(orders.map((o) => [o.quote_id, o.id]));
  const rateByOrderId: OrderRateLookup = {};
  for (const o of orders) {
    const rate = o.quotes?.fx_snapshot?.effective_rate;
    if (rate != null) rateByOrderId[o.id] = rate;
  }

  const payments: PnlPaymentInput[] = ((paymentsResult.data as unknown as PaymentJoinRow[]) ?? []).map((p) => ({
    amountJmd: p.amount_jmd,
    paidAtIso: p.paid_at,
    orderId: p.invoices?.quote_id ? (quoteIdToOrderId.get(p.invoices.quote_id) ?? null) : null,
    quoteRef: p.invoices?.quotes?.quote_ref ?? "—",
    invoiceNumber: p.invoices?.invoice_number ?? "—",
  }));

  const costs: PnlCostInput[] = ((costsResult.data as unknown as CostJoinRow[]) ?? []).map((c) => ({
    orderId: c.order_id,
    amountUsd: c.amount_usd,
    amountJmd: c.amount_jmd,
    incurredDateIso: c.incurred_date,
    category: c.category,
  }));

  const monthly = computePnlByMonth(payments, costs, rateByOrderId, range);
  const byOrder = computePnlByOrder(payments, costs, rateByOrderId, range);
  const totalRevenue = monthly.reduce((s, r) => s + r.revenueJmd, 0);
  const totalCost = monthly.reduce((s, r) => s + r.costJmd, 0);
  const totalGrossProfit = totalRevenue - totalCost;
  const totalUnconverted = monthly.reduce((s, r) => s + r.unconvertedCostUsd, 0);

  return (
    <div className="max-w-6xl">
      <Link
        href="/admin/reports"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← Reports
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-veridan-ink">Profit &amp; loss</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Cash basis — revenue is invoice payments actually received, never a quote&apos;s projected total. Costs are
        actual costs recorded against each order, converted to JMD for display at each order&apos;s own quote-locked
        FX rate where a cost was entered in USD only.
      </p>

      <div className="mt-6">
        <DateRangeFilter startIso={range.startIso} endIso={range.endIso} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Revenue (cash basis)</p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatJmd(totalRevenue, 2)}</p>
        </div>
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Actual costs</p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatJmd(totalCost, 2)}</p>
        </div>
        <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Gross profit</p>
          <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatJmd(totalGrossProfit, 2)}</p>
          <p className="text-xs text-veridan-warm-gray">
            {totalRevenue > 0 ? formatPct(Math.round((totalGrossProfit / totalRevenue) * 1000) / 10) : "—"} margin
          </p>
        </div>
      </div>

      {totalUnconverted > 0 && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {formatUsd(totalUnconverted)} of actual costs could not be converted to JMD (no order-locked FX rate found)
          and is excluded from the totals above.
        </div>
      )}

      {/* Monthly */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">By month</h2>
        <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
          <table className="w-full min-w-[640px] table-auto border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Gross profit</th>
                <th className="px-3 py-2 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((row) => (
                <tr key={row.monthKey} className="border-b border-veridan-warm-gray-light last:border-b-0">
                  <td className="px-3 py-2 text-veridan-ink">{row.monthKey}</td>
                  <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(row.revenueJmd, 2)}</td>
                  <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(row.costJmd, 2)}</td>
                  <td className="px-3 py-2 text-right font-medium text-veridan-ink">{formatJmd(row.grossProfitJmd, 2)}</td>
                  <td className="px-3 py-2 text-right text-veridan-ink">
                    {row.marginPct != null ? formatPct(Math.round(row.marginPct * 10) / 10) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Per order */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">By order</h2>
        {byOrder.length === 0 ? (
          <InstructiveMessage
            title="No order-attributed revenue in this range"
            body="Payments not yet linked to an order (its quote has no order created) still count in the monthly totals above, but have no row here."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[640px] table-auto border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Gross profit</th>
                  <th className="px-3 py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {byOrder.map((row) => (
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
                    <td className="px-3 py-2 text-right font-medium text-veridan-ink">{formatJmd(row.grossProfitJmd, 2)}</td>
                    <td className="px-3 py-2 text-right text-veridan-ink">
                      {row.marginPct != null ? formatPct(Math.round(row.marginPct * 10) / 10) : "—"}
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

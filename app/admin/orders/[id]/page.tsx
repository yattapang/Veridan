import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActualCostWithSupplier, OrderRow, SupplierRow } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import {
  ACTUAL_COST_CATEGORY_LABELS,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABELS,
  computeActualCostTotals,
} from "@/lib/orders/format";
import { isOrderClosed } from "@/lib/orders/workflow";
import { formatJmd, formatUsd } from "@/lib/quotes/format";
import { StatusPanel } from "./StatusPanel";
import { ActualCostForm } from "./ActualCostForm";
import { ActualCostRow } from "./ActualCostRow";
import { NotesForm } from "./NotesForm";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Order · ${id}` };
}

function supabaseUnconfigured() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Order</h1>
      <InstructiveMessage
        title="Supabase is not configured"
        body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
      />
    </div>
  );
}

interface OrderDetailQuote {
  id: string;
  quote_ref: string;
  total_client_usd: number | null;
  total_client_jmd: number | null;
  fx_snapshot: { effective_rate: number };
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return supabaseUnconfigured();
  }

  const { data: orderData, error: orderError } = await supabase
    .from("orders")
    .select("*, quotes(id, quote_ref, total_client_usd, total_client_jmd, fx_snapshot), projects(id, name), companies(id, name)")
    .eq("id", id)
    .maybeSingle();

  if (orderError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Order</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The order couldn't be loaded (${orderError.message}). Check that migrations are applied and reload.`}
        />
      </div>
    );
  }
  if (!orderData) notFound();

  const order = orderData as unknown as OrderRow & {
    quotes: OrderDetailQuote | null;
    projects: { id: string; name: string } | null;
    companies: { id: string; name: string } | null;
  };

  const [costsResult, suppliersResult] = await Promise.all([
    supabase
      .from("actual_costs")
      .select("*, suppliers(id, name)")
      .eq("order_id", order.id)
      .order("incurred_date", { ascending: false }),
    supabase.from("suppliers").select("*").eq("active", true).order("name"),
  ]);

  const costs = (costsResult.data as unknown as ActualCostWithSupplier[]) ?? [];
  const suppliers = (suppliersResult.data as SupplierRow[]) ?? [];
  const effectiveRate = order.quotes?.fx_snapshot?.effective_rate ?? 0;
  const totals = computeActualCostTotals(costs, effectiveRate);
  const closed = isOrderClosed(order.status);

  const categoryEntries = (Object.keys(ACTUAL_COST_CATEGORY_LABELS) as Array<keyof typeof ACTUAL_COST_CATEGORY_LABELS>).filter(
    (cat) => totals.byCategory[cat],
  );

  return (
    <div className="max-w-5xl">
      <Link
        href="/admin/orders"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← All orders
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-veridan-ink">
          {order.quotes ? order.quotes.quote_ref : "Order"}
        </h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${ORDER_STATUS_BADGE[order.status]}`}
        >
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>

      <p className="mt-2 text-sm text-veridan-warm-gray">
        {order.projects ? (
          <Link href={`/admin/projects/${order.projects.id}`} className="underline underline-offset-2 hover:text-veridan-ink">
            {order.projects.name}
          </Link>
        ) : (
          "Unknown project"
        )}
        {order.companies && <> · {order.companies.name}</>}
        {order.quotes && (
          <>
            {" "}
            ·{" "}
            <Link href={`/admin/quotes/${order.quotes.id}`} className="underline underline-offset-2 hover:text-veridan-ink">
              View quote
            </Link>
          </>
        )}
      </p>

      {/* Status */}
      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">Status</h2>
        <StatusPanel orderId={order.id} status={order.status} />
        {order.customs_cleared_at && (
          <p className="mt-3 text-xs text-veridan-warm-gray">
            Customs cleared {new Date(order.customs_cleared_at).toLocaleString()}
          </p>
        )}
        {order.delivered_at && (
          <p className="mt-1 text-xs text-veridan-warm-gray">
            Delivered {new Date(order.delivered_at).toLocaleString()}
          </p>
        )}
        {order.closed_at && (
          <p className="mt-1 text-xs text-veridan-warm-gray">Closed {new Date(order.closed_at).toLocaleString()}</p>
        )}
      </section>

      {/* Quoted vs actuals comparison */}
      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Quoted vs. actuals to date
        </h2>
        <p className="mb-3 text-xs text-veridan-warm-gray">
          Actuals below are converted to the quote&apos;s locked FX rate ({effectiveRate ? effectiveRate.toFixed(2) : "—"}{" "}
          JMD per USD) for COMPARISON DISPLAY ONLY — every row still stores exactly what was entered, in whichever
          currency it arrived in.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Quoted total</p>
            <p className="mt-1 text-lg font-semibold text-veridan-ink">{formatUsd(order.quotes?.total_client_usd ?? null)}</p>
            <p className="text-xs text-veridan-warm-gray">{formatJmd(order.quotes?.total_client_jmd ?? null, 2)}</p>
          </div>
          <div className="rounded-md bg-veridan-warm-gray-pale/60 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Actuals to date</p>
            <p className="mt-1 text-lg font-semibold text-veridan-ink">
              {totals.overall.amountUsd != null ? formatUsd(totals.overall.amountUsd) : "—"}
            </p>
            <p className="text-xs text-veridan-warm-gray">
              {totals.overall.amountJmd != null ? formatJmd(totals.overall.amountJmd, 2) : "—"}
            </p>
          </div>
        </div>
        {categoryEntries.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-md border border-veridan-warm-gray-light">
            <table className="w-full min-w-[480px] table-auto border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">USD</th>
                  <th className="px-3 py-2 text-right">JMD</th>
                </tr>
              </thead>
              <tbody>
                {categoryEntries.map((cat) => {
                  const amounts = totals.byCategory[cat];
                  return (
                    <tr key={cat} className="border-b border-veridan-warm-gray-light last:border-b-0">
                      <td className="px-3 py-2 text-veridan-ink">{ACTUAL_COST_CATEGORY_LABELS[cat]}</td>
                      <td className="px-3 py-2 text-right text-veridan-ink">
                        {amounts.amountUsd != null ? formatUsd(amounts.amountUsd) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-veridan-ink">
                        {amounts.amountJmd != null ? formatJmd(amounts.amountJmd, 2) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Actual costs */}
      <section className="mt-8">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">Actual costs</h2>
        <p className="mb-3 text-xs text-veridan-warm-gray">
          Real money spent fulfilling this order — never derived from the quote. Rows are immediate and freely
          editable/deletable{closed ? "" : " until the order is closed"}.
        </p>
        {costs.length === 0 ? (
          <InstructiveMessage title="No actual costs recorded yet" body="Add the first cost below as bills come in." />
        ) : (
          <div className="mb-4 overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[720px] table-auto border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 text-right">USD</th>
                  <th className="px-4 py-2 text-right">JMD</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {costs.map((cost) => (
                  <ActualCostRow key={cost.id} orderId={order.id} cost={cost} suppliers={suppliers} canEdit={!closed} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!closed && (
          <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
              Add an actual cost
            </h3>
            {suppliers.length === 0 ? (
              <p className="mb-3 text-xs text-veridan-warm-gray">
                No active suppliers — supplier attribution is optional, you can still record costs below.
              </p>
            ) : null}
            <ActualCostForm orderId={order.id} suppliers={suppliers} />
          </div>
        )}
      </section>

      {/* Notes */}
      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">Notes</h2>
        <NotesForm orderId={order.id} notes={order.notes} />
      </section>
    </div>
  );
}

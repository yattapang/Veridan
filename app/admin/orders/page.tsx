import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { ActualCostRow, OrderWithRefs } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { ORDER_STATUS_BADGE, ORDER_STATUS_LABELS, computeActualCostTotals } from "@/lib/orders/format";
import { formatUsd } from "@/lib/quotes/format";

export const metadata = {
  title: "Orders",
};

export default async function OrdersPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Orders</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let orders: OrderWithRefs[] = [];
  let loadError: string | null = null;
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*, quotes(id, quote_ref, total_client_usd, total_client_jmd), projects(id, name), companies(id, name)")
      .order("created_at", { ascending: false });
    if (error) loadError = error.message;
    else orders = (data as unknown as OrderWithRefs[]) ?? [];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Orders</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The orders table couldn't be loaded (${loadError}). Check that migrations are applied and reload.`}
        />
      </div>
    );
  }

  // Actuals-to-date per order, converted at each order's own quote-locked fx
  // rate for the "quoted vs actuals" comparison column — display only, never
  // stored (see lib/orders/format.ts's convertAtQuoteRate header).
  const orderIds = orders.map((o) => o.id);
  let actualsByOrder = new Map<string, { amountUsd: number | null; amountJmd: number | null }>();
  if (orderIds.length > 0) {
    const { data: costsData } = await supabase
      .from("actual_costs")
      .select("order_id, category, amount_usd, amount_jmd")
      .in("order_id", orderIds);
    const costs = (costsData as ActualCostRow[]) ?? [];
    const costsByOrder = new Map<string, ActualCostRow[]>();
    for (const c of costs) {
      const bucket = costsByOrder.get(c.order_id) ?? [];
      bucket.push(c);
      costsByOrder.set(c.order_id, bucket);
    }
    actualsByOrder = new Map(
      orders.map((o) => {
        // FX rate the quote locked at creation time — informational fallback
        // to 0 (renders as "—") if the joined quote failed to load for some
        // reason; never a live parameter read.
        const rate = effectiveRateFor(o);
        const totals = computeActualCostTotals(costsByOrder.get(o.id) ?? [], rate);
        return [o.id, totals.overall];
      }),
    );
  }

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Orders</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        An order tracks a quote&apos;s fulfillment once the founder clicks &quot;Create order&quot; on an accepted
        quote. Actuals-to-date are entered by hand on each order&apos;s page and are the source of truth for the
        P&amp;L and cash-flow reports — never the quoted total shown here for comparison.
      </p>

      <section className="mt-8">
        {orders.length === 0 ? (
          <InstructiveMessage
            title="No orders yet"
            body="Open an accepted quote and click “Create order” to start tracking its fulfillment and actual costs."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[960px] table-auto border-collapse text-left">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Quote</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2 text-right">Quoted total USD</th>
                  <th className="px-3 py-2 text-right">Actuals to date USD</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const actuals = actualsByOrder.get(order.id);
                  return (
                    <tr key={order.id} className="border-b border-veridan-warm-gray-light last:border-b-0">
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${ORDER_STATUS_BADGE[order.status]}`}
                        >
                          {ORDER_STATUS_LABELS[order.status]}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-sm text-veridan-ink">
                        {order.quotes ? (
                          <Link
                            href={`/admin/quotes/${order.quotes.id}`}
                            className="underline underline-offset-2 hover:text-veridan-accent"
                          >
                            {order.quotes.quote_ref}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-veridan-ink">
                        {order.projects ? (
                          <Link
                            href={`/admin/projects/${order.projects.id}`}
                            className="underline underline-offset-2 hover:text-veridan-accent"
                          >
                            {order.projects.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-veridan-warm-gray">{order.companies?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-sm text-veridan-ink">
                        {formatUsd(order.quotes?.total_client_usd ?? null)}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-medium text-veridan-ink">
                        {actuals?.amountUsd != null ? formatUsd(actuals.amountUsd) : "—"}
                      </td>
                      <td className="px-3 py-2 text-sm text-veridan-warm-gray">
                        {new Date(order.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Derives an order's quote-locked JMD-per-USD rate from the joined quote's
 * cached totals (total_client_jmd / total_client_usd), rather than a second
 * round trip for fx_snapshot — good enough for this list view's display-only
 * comparison column; the order detail page reads fx_snapshot.effective_rate
 * directly for its own (more precise) running totals.
 */
function effectiveRateFor(order: OrderWithRefs): number {
  const jmd = order.quotes?.total_client_jmd;
  const usd = order.quotes?.total_client_usd;
  if (jmd == null || usd == null || usd <= 0) return 0;
  return jmd / usd;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ItemGroupRow, ProductWithSupplier } from "@/lib/supabase/types";
import { groupByFinish } from "@/lib/item-groups";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";

export async function generateMetadata({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return { title: `Compare offerings · ${groupId}` };
}

function formatCost(unitCost: number, currency: string) {
  return `${currency} ${unitCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * "Compare offerings" view (Task 31, plan §1.5): every products row
 * sharing an item_group_id, grouped by finish_code, showing supplier name,
 * unit_cost, cost_currency, and last-updated date side by side — the
 * direct answer to "an item of a particular grade may have multiple
 * suppliers... we need to filter these."
 */
export default async function CompareOfferingsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Compare offerings</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const [groupResult, productsResult] = await Promise.all([
    supabase.from("item_groups").select("*").eq("id", groupId).maybeSingle<ItemGroupRow>(),
    supabase
      .from("products")
      .select("*, suppliers(id, name)")
      .eq("item_group_id", groupId)
      .order("finish_code", { nullsFirst: true }),
  ]);

  if (groupResult.error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Compare offerings</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The item group couldn't be loaded (${groupResult.error.message}).`}
        />
      </div>
    );
  }

  const itemGroup = groupResult.data;
  if (!itemGroup) {
    notFound();
  }

  const products = ((productsResult.data as unknown as ProductWithSupplier[]) ?? []).filter((p) => p.active);
  const groups = groupByFinish(products);

  return (
    <div className="max-w-4xl">
      <Link
        href="/admin/item-groups"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← Back to item groups
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-veridan-ink">
        {itemGroup.family_name}
        {itemGroup.grade ? ` — ${itemGroup.grade}` : ""}
      </h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        {products.length} active offering{products.length === 1 ? "" : "s"} of this item, grouped by finish.
      </p>

      {products.length === 0 ? (
        <div className="mt-8">
          <InstructiveMessage
            title="No offerings yet"
            body="No active products currently belong to this item group."
          />
        </div>
      ) : (
        Array.from(groups.entries()).map(([finish, group]) => (
          <section key={finish} className="mt-8">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
              Finish: {finish}
            </h2>
            <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-veridan-warm-gray-light text-xs uppercase tracking-wide text-veridan-warm-gray">
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2">Supplier</th>
                    <th className="px-4 py-2">Unit cost</th>
                    <th className="px-4 py-2">Currency</th>
                    <th className="px-4 py-2">Last updated</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((product) => (
                    <tr key={product.id} className="border-b border-veridan-warm-gray-light last:border-b-0">
                      <td className="px-4 py-2 text-veridan-ink">{product.description}</td>
                      <td className="px-4 py-2 text-veridan-ink/80">{product.suppliers?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-veridan-ink/80">
                        {formatCost(product.unit_cost, product.cost_currency)}
                      </td>
                      <td className="px-4 py-2 text-veridan-ink/80">{product.cost_currency}</td>
                      <td className="px-4 py-2 text-veridan-ink/80">{formatDate(product.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

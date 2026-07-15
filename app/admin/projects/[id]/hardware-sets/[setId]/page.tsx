import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  BusinessParameterRow,
  HardwareSetLineItemWithDetails,
  HardwareSetRow,
  ProductWithSupplier,
  SupplierRow,
} from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { summarizeSetUsd, type SupplierFxRates } from "@/lib/hardware-sets";
import { LineItemRow } from "./LineItemRow";
import { AddLineItemForm } from "./AddLineItemForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; setId: string }>;
}) {
  const { setId } = await params;
  return { title: `Hardware set · ${setId}` };
}

const PRODUCT_RESULT_LIMIT = 15;

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default async function HardwareSetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; setId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id: projectId, setId } = await params;
  const query = await searchParams;
  const pq = firstParam(query.pq).trim();
  const safePq = pq.replace(/[,]/g, " ").trim();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Hardware set</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let set: HardwareSetRow | null = null;
  let loadError: string | null = null;

  try {
    const { data, error } = await supabase
      .from("hardware_sets")
      .select("*")
      .eq("id", setId)
      .maybeSingle<HardwareSetRow>();
    if (error) loadError = error.message;
    else set = data;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Hardware set</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The hardware set couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  if (!set || set.project_id !== projectId) {
    notFound();
  }

  const [linesResult, suppliersResult, fxParamResult, productsResult] = await Promise.all([
    supabase
      .from("hardware_set_line_items")
      .select(
        "*, products(id, description, manufacturer, product_ref, catalogue_ref, unit, unit_cost, cost_currency), suppliers(id, name, default_currency)"
      )
      .eq("hardware_set_id", setId)
      .order("sort_order"),
    supabase.from("suppliers").select("*").eq("active", true).order("name"),
    supabase.from("business_parameters").select("*").eq("key", "supplier_fx_rates").maybeSingle(),
    safePq
      ? supabase
          .from("products")
          .select("*, suppliers(id, name)")
          .eq("active", true)
          .or(
            `description.ilike.%${safePq}%,catalogue_ref.ilike.%${safePq}%,manufacturer.ilike.%${safePq}%,product_ref.ilike.%${safePq}%`
          )
          .order("description")
          .limit(PRODUCT_RESULT_LIMIT)
      : Promise.resolve({ data: [] as ProductWithSupplier[], error: null }),
  ]);

  const lines = (linesResult.data as unknown as HardwareSetLineItemWithDetails[]) ?? [];
  const suppliers = (suppliersResult.data as SupplierRow[]) ?? [];
  const products = (productsResult.data as unknown as ProductWithSupplier[]) ?? [];

  const fxParam = fxParamResult.data as BusinessParameterRow | null;
  const fxRates: SupplierFxRates =
    fxParam && fxParam.value.type === "table" && typeof fxParam.value.value === "object"
      ? (fxParam.value.value as SupplierFxRates)
      : {};

  const summary = summarizeSetUsd(lines, fxRates);
  const inputClass =
    "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

  return (
    <div className="max-w-3xl">
      <Link
        href={`/admin/projects/${projectId}`}
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← Back to project
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-veridan-ink">
        {set.code}
        {set.name ? ` — ${set.name}` : ""}
      </h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        {summary.lineCount} line item{summary.lineCount === 1 ? "" : "s"} ·{" "}
        {summary.lineCount === 0 ? "—" : formatUsd(summary.subtotalUsd)} indicative supplier
        cost{summary.incomplete ? " (some lines couldn't be converted — check FX parameters)" : ""}
        {set.cloned_from_set_id ? " · cloned from another project" : ""}
      </p>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Line items
        </h2>
        {suppliers.length === 0 && (
          <div className="mb-4">
            <InstructiveMessage
              title="No active suppliers"
              body="Add a supplier under /admin/suppliers before adding line items."
            />
          </div>
        )}
        {lines.length === 0 ? (
          <InstructiveMessage
            title="No line items yet"
            body="Search the Hardware Library below and add products to this set."
          />
        ) : (
          <ul className="mb-6 rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {lines.map((line) => (
              <LineItemRow
                key={line.id}
                projectId={projectId}
                setId={setId}
                line={line}
                suppliers={suppliers}
                fxRates={fxRates}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Add a product to this set
        </h2>
        <p className="mb-3 text-xs text-veridan-warm-gray">
          Search the Hardware Library, then pick a line and set its
          supplier, quantity, and any per-quote override before adding.
        </p>
        <form method="get" className="mb-4 flex gap-3">
          <input
            type="text"
            name="pq"
            defaultValue={pq}
            placeholder="Description, catalogue ref, manufacturer, SKU…"
            className={inputClass}
          />
          <button
            type="submit"
            className="shrink-0 rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90"
          >
            Search
          </button>
        </form>

        {pq && products.length === 0 && (
          <InstructiveMessage title="No products match" body="Try a different search term, or add the product to the Hardware Library first." />
        )}

        <AddLineItemForm projectId={projectId} setId={setId} products={products} suppliers={suppliers} />
      </section>
    </div>
  );
}

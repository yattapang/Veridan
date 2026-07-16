import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  OverrideLogWithUser,
  ProductWithSupplier,
  QuoteLineItemWithDetails,
  QuoteOriginRow,
  QuoteWithProject,
  SupplierRow,
} from "@/lib/supabase/types";
import type { DoorRollup, LineResult, OriginResult } from "@/lib/landed-cost/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { computeQuoteResult } from "@/lib/quotes/mapping";
import {
  OVERRIDE_TYPE_LABELS,
  QUOTE_STATUS_BADGE,
  QUOTE_STATUS_LABELS,
  formatPct,
  formatUsd,
} from "@/lib/quotes/format";
import { FxSnapshotPanel } from "./FxSnapshotPanel";
import { QuoteOriginCard } from "./QuoteOriginCard";
import { MarginPanel, type MarginLine, type PackagePrice } from "./MarginPanel";
import { AddQuoteLineForm } from "./AddQuoteLineForm";
import { QuoteLineRow } from "./QuoteLineRow";

const MODE_LABELS: Record<string, string> = {
  door_register: "Door Register mode",
  line_item: "Line-item mode",
};

const PRODUCT_RESULT_LIMIT = 15;

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Quote · ${id}` };
}

function supabaseUnconfigured() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Quote</h1>
      <InstructiveMessage
        title="Supabase is not configured"
        body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
      />
    </div>
  );
}

export default async function QuoteBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const pq = firstParam(query.pq).trim();
  const safePq = pq.replace(/[,]/g, " ").trim();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return supabaseUnconfigured();
  }

  const { data: quoteData, error: quoteError } = await supabase
    .from("quotes")
    .select("*, projects(id, name, companies(id, name))")
    .eq("id", id)
    .maybeSingle();

  if (quoteError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Quote</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The quote couldn't be loaded (${quoteError.message}). Check that migrations are applied and reload.`}
        />
      </div>
    );
  }
  if (!quoteData) notFound();
  const quote = quoteData as unknown as QuoteWithProject;
  const isLineItemMode = quote.quote_mode === "line_item";

  const [originsResult, linesResult, overridesResult, suppliersResult, productsResult] = await Promise.all([
    supabase.from("quote_origins").select("*").eq("quote_id", id).order("origin_label"),
    supabase
      .from("quote_line_items")
      .select(
        "*, products(id, description, manufacturer, product_ref, unit), doors(id, door_number, floor), hardware_sets(id, code, name), suppliers(id, name)"
      )
      .eq("quote_id", id)
      .order("sort_order"),
    supabase
      .from("override_log")
      .select("*, users(id, email, display_name)")
      .eq("quote_id", id)
      .order("created_at", { ascending: false }),
    isLineItemMode
      ? supabase.from("suppliers").select("*").eq("active", true).order("name")
      : Promise.resolve({ data: [] as SupplierRow[], error: null }),
    isLineItemMode && safePq
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

  const origins = (originsResult.data as QuoteOriginRow[]) ?? [];
  const lines = (linesResult.data as unknown as QuoteLineItemWithDetails[]) ?? [];
  const overrides = (overridesResult.data as unknown as OverrideLogWithUser[]) ?? [];
  const suppliers = (suppliersResult.data as SupplierRow[]) ?? [];
  const products = (productsResult.data as unknown as ProductWithSupplier[]) ?? [];

  const isDraft = quote.status === "draft";

  // Run the engine over the quote's own frozen snapshots for live display.
  const result = computeQuoteResult({ quote, origins, lines });

  const originResultById = new Map<string, OriginResult>(result.origins.map((o) => [o.originId, o]));
  const lineDetailById = new Map<string, QuoteLineItemWithDetails>(lines.map((l) => [l.id, l]));
  const lineResultById = new Map<string, LineResult>(result.lines.map((l) => [l.lineId, l]));

  function lineLabel(lr: LineResult): string {
    const detail = lineDetailById.get(lr.lineId);
    return detail?.products?.description ?? detail?.description_override ?? "Line item";
  }
  function doorLabel(lr: LineResult): string {
    const d = lineDetailById.get(lr.lineId)?.doors;
    if (!d) return "";
    return d.floor ? `${d.door_number} · ${d.floor}` : d.door_number;
  }

  // Read-only breakdown grouped per door.
  const linesByDoor = new Map<string, LineResult[]>();
  const doorlessLines: LineResult[] = [];
  for (const lr of result.lines) {
    if (!lr.doorId) {
      doorlessLines.push(lr);
      continue;
    }
    const list = linesByDoor.get(lr.doorId) ?? [];
    list.push(lr);
    linesByDoor.set(lr.doorId, list);
  }
  function doorHeading(doorId: string): string {
    const anyLine = linesByDoor.get(doorId)?.[0];
    const d = anyLine ? lineDetailById.get(anyLine.lineId) : undefined;
    const setCode = d?.hardware_sets?.code;
    const num = d?.doors?.door_number ?? doorId;
    const floor = d?.doors?.floor;
    return [num, floor, setCode].filter(Boolean).join(" · ");
  }

  // Per-line margin table data.
  const marginLines: MarginLine[] = result.lines.map((lr) => ({
    lineId: lr.lineId,
    label: lineLabel(lr),
    doorLabel: doorLabel(lr),
    landedCostUsd: lr.landedCostUsd,
    marginPct: lr.marginPct,
    clientPriceUsd: lr.clientPriceUsdRounded,
    clientPriceJmd: lr.clientPriceJmdRounded,
    currentOverride: lineDetailById.get(lr.lineId)?.margin_pct_override ?? null,
  }));

  // Per-door package pricing grouped by hardware set.
  const setMeta = new Map<string, { code: string; name: string | null }>();
  for (const l of lines) {
    if (l.hardware_set_id && l.hardware_sets) {
      setMeta.set(l.hardware_set_id, { code: l.hardware_sets.code, name: l.hardware_sets.name });
    }
  }
  const rollupsBySet = new Map<string, DoorRollup[]>();
  for (const d of result.doors) {
    if (!d.hardwareSetId) continue;
    const list = rollupsBySet.get(d.hardwareSetId) ?? [];
    list.push(d);
    rollupsBySet.set(d.hardwareSetId, list);
  }
  const packages: PackagePrice[] = [...rollupsBySet.entries()].map(([setId, rolls]) => {
    const jmds = new Set(rolls.map((r) => r.clientPriceJmd));
    const meta = setMeta.get(setId);
    return {
      setCode: meta?.code ?? "—",
      setName: meta?.name ?? null,
      doorCount: rolls.length,
      perDoorLandedUsd: rolls[0].landedCostUsd,
      perDoorClientJmd: rolls[0].clientPriceJmd,
      varies: jmds.size > 1,
    };
  });

  const tiers = quote.parameters_snapshot?.margin_tiers ?? [30, 35, 40];

  return (
    <div className="max-w-5xl">
      <Link
        href="/admin/quotes"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← All quotes
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-veridan-ink">{quote.quote_ref}</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${QUOTE_STATUS_BADGE[quote.status]}`}
        >
          {QUOTE_STATUS_LABELS[quote.status]}
        </span>
        {quote.revision_number > 1 && (
          <span className="text-xs text-veridan-warm-gray">revision {quote.revision_number}</span>
        )}
      </div>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        {quote.projects ? (
          <Link href={`/admin/projects/${quote.projects.id}`} className="underline underline-offset-2 hover:text-veridan-ink">
            {quote.projects.name}
          </Link>
        ) : (
          "Unknown project"
        )}
        {quote.projects?.companies && <> · {quote.projects.companies.name}</>} ·{" "}
        {MODE_LABELS[quote.quote_mode] ?? quote.quote_mode} · quoted {quote.quote_date} · deposit{" "}
        {formatPct(quote.deposit_pct)} · valid {quote.validity_days} days
      </p>

      {!isDraft && (
        <div className="mt-4">
          <InstructiveMessage
            title="This quote is read-only"
            body="Only draft quotes can be edited. Create a revision to make changes (revision flow arrives in Task 19)."
          />
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="mt-4">
          <InstructiveMessage
            title="Some lines could not be priced"
            body={result.errors.map((e) => e.message).join(" ")}
          />
        </div>
      )}

      {/* FX snapshot */}
      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">FX snapshot</h2>
        <FxSnapshotPanel quoteId={quote.id} fx={quote.fx_snapshot} isDraft={isDraft} />
      </section>

      {/* Origin cost pools */}
      <section className="mt-8">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Shipment origins
        </h2>
        <p className="mb-3 text-xs text-veridan-warm-gray">
          One cost pool per supplier origin. Costs default from the parameter snapshot; the engine
          allocates each pool&apos;s total shipment cost pro-rata by line value.
        </p>
        {origins.length === 0 ? (
          <InstructiveMessage
            title="No shipment origins"
            body="This quote has no line items yet, so no origin pools were created."
          />
        ) : (
          <div className="space-y-4">
            {origins.map((origin) => (
              <QuoteOriginCard
                key={origin.id}
                quoteId={quote.id}
                origin={origin}
                computed={originResultById.get(origin.id)}
                isDraft={isDraft}
              />
            ))}
          </div>
        )}
      </section>

      {/* Line breakdown grouped per door (door_register mode) */}
      {!isLineItemMode && result.lines.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Line breakdown by door
          </h2>
          <div className="space-y-4">
            {[...linesByDoor.entries()].map(([doorId, doorLines]) => (
              <div key={doorId} className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
                <div className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/40 px-4 py-2 text-xs font-semibold text-veridan-ink">
                  {doorHeading(doorId)}
                </div>
                <table className="w-full min-w-[640px] table-auto border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-veridan-warm-gray-light text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                      <th className="px-4 py-2">Product</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                      <th className="px-4 py-2 text-right">Supplier cost USD</th>
                      <th className="px-4 py-2 text-right">Allocated shipment USD</th>
                      <th className="px-4 py-2 text-right">Landed USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doorLines.map((lr) => (
                      <tr key={lr.lineId} className="border-b border-veridan-warm-gray-light last:border-b-0">
                        <td className="px-4 py-2 text-veridan-ink">{lineLabel(lr)}</td>
                        <td className="px-4 py-2 text-right text-veridan-warm-gray">{lr.qty}</td>
                        <td className="px-4 py-2 text-right text-veridan-ink">{formatUsd(lr.lineValueUsd)}</td>
                        <td className="px-4 py-2 text-right text-veridan-warm-gray">{formatUsd(lr.allocatedShipmentCostUsd)}</td>
                        <td className="px-4 py-2 text-right font-medium text-veridan-ink">{formatUsd(lr.landedCostUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {doorlessLines.length > 0 && (
              <p className="text-xs text-veridan-warm-gray">
                {doorlessLines.length} line{doorlessLines.length === 1 ? "" : "s"} not tied to a door.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Flat line table + add-line form (line_item mode) */}
      {isLineItemMode && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">Lines</h2>
          {lines.length === 0 ? (
            <InstructiveMessage
              title="No lines yet"
              body="Add product or ad-hoc lines below. Shipment origin pools are created automatically from each line's supplier."
            />
          ) : (
            <div className="mb-4 overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
              <table className="w-full min-w-[720px] table-auto border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                    <th className="px-4 py-2">Line</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Landed USD</th>
                    <th className="px-4 py-2 text-right">Client USD</th>
                    <th className="px-4 py-2 text-right">Client JMD</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const lr = lineResultById.get(line.id);
                    return (
                      <QuoteLineRow
                        key={line.id}
                        quoteId={quote.id}
                        line={line}
                        suppliers={suppliers}
                        landedCostUsd={lr?.landedCostUsd ?? line.landed_cost_usd}
                        clientPriceUsd={lr?.clientPriceUsdRounded ?? null}
                        clientPriceJmd={lr?.clientPriceJmdRounded ?? null}
                        isDraft={isDraft}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {isDraft && (
            <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">Add a line</h3>
              <form method="get" className="mb-4 flex gap-3">
                <input
                  type="text"
                  name="pq"
                  defaultValue={pq}
                  placeholder="Search the Hardware Library: description, catalogue ref, manufacturer, SKU…"
                  className="w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90"
                >
                  Search
                </button>
              </form>
              {pq && products.length === 0 && (
                <div className="mb-4">
                  <InstructiveMessage title="No products match" body="Try a different search term, or add the ad-hoc line below." />
                </div>
              )}
              {suppliers.length === 0 ? (
                <InstructiveMessage title="No active suppliers" body="Add a supplier under /admin/suppliers before adding lines." />
              ) : (
                <AddQuoteLineForm quoteId={quote.id} products={products} suppliers={suppliers} />
              )}
            </div>
          )}
        </section>
      )}

      {/* Margin + totals + override gate */}
      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Margin &amp; client pricing
        </h2>
        {result.lines.length === 0 ? (
          <p className="text-sm text-veridan-warm-gray">
            {isLineItemMode
              ? "Add lines above to price this quote."
              : "Add doors with hardware sets and recreate the quote to price it."}
          </p>
        ) : (
          <MarginPanel
            quoteId={quote.id}
            isDraft={isDraft}
            tiers={tiers}
            currentMargin={Number(quote.margin_pct)}
            effectiveRate={result.effectiveJmdRate}
            bankSellRate={quote.fx_snapshot.bank_sell_rate}
            fxBufferPct={quote.fx_snapshot.fx_buffer_pct}
            lines={marginLines}
            packages={packages}
            totals={result.totals}
          />
        )}
      </section>

      {/* Logged overrides */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Overrides on this quote
        </h2>
        {overrides.length === 0 ? (
          <p className="text-sm text-veridan-warm-gray">No overrides logged.</p>
        ) : (
          <ul className="space-y-2">
            {overrides.map((o) => (
              <li key={o.id} className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                <p className="font-medium text-amber-800">
                  {OVERRIDE_TYPE_LABELS[o.override_type]} · requested margin {formatPct(o.requested_margin_pct)}
                </p>
                <p className="mt-1 text-amber-800">{o.reason}</p>
                <p className="mt-1 text-xs text-amber-700">
                  {o.users?.display_name ?? o.users?.email ?? "Unknown user"} · {new Date(o.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Status transitions (Task 19) */}
      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Workflow
        </h2>
        <p className="mb-3 text-xs text-veridan-warm-gray">
          Approve / send / accept and the revision flow arrive in Task 19. Buttons are disabled here.
        </p>
        <div className="flex flex-wrap gap-3">
          {["Approve", "Send", "Accept", "Create revision"].map((label) => (
            <button
              key={label}
              type="button"
              disabled
              title="Available in Task 19"
              className="cursor-not-allowed rounded-md border border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-warm-gray opacity-60"
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

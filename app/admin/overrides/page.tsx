import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { OverrideLogWithDetails } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { OVERRIDE_TYPE_LABELS, formatUsd, formatPct } from "@/lib/quotes/format";

export const metadata = {
  title: "Overrides",
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Override log (Task 22, §6.3.5) — read-only visibility into every
 * margin/floor override, for both founders. Rows are written by
 * app/admin/quotes/[id]/actions.ts at quote-save time (Task 16/17); this
 * page never writes anything.
 */
export default async function OverridesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const quoteSearch = firstParam(params.quote).trim();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Overrides</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let quoteIdFilter: string[] | null = null;
  let overrides: OverrideLogWithDetails[] = [];
  let loadError: string | null = null;

  try {
    if (quoteSearch) {
      const { data: matches, error: matchError } = await supabase
        .from("quotes")
        .select("id")
        .ilike("quote_ref", `%${quoteSearch}%`);
      if (matchError) throw new Error(matchError.message);
      quoteIdFilter = (matches ?? []).map((m) => m.id as string);
    }

    let query = supabase
      .from("override_log")
      .select("*, quotes(id, quote_ref), users(id, email, display_name)")
      .order("created_at", { ascending: false });
    if (quoteIdFilter) {
      query = quoteIdFilter.length > 0 ? query.in("quote_id", quoteIdFilter) : query.eq("quote_id", "00000000-0000-0000-0000-000000000000");
    }

    const { data, error } = await query;
    if (error) loadError = error.message;
    else overrides = (data as unknown as OverrideLogWithDetails[]) ?? [];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Overrides</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`override_log couldn't be loaded (${loadError}). Check that the Supabase project is running and every migration in supabase/migrations has been applied, then reload.`}
        />
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Overrides</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Every margin-floor override is recorded and visible to both founders &mdash; PRD §6.3.5.
      </p>

      <form className="mt-6 flex items-end gap-2" action="/admin/overrides">
        <div>
          <label htmlFor="quote" className="block text-xs font-medium text-veridan-warm-gray">
            Filter by quote ref
          </label>
          <input
            id="quote"
            name="quote"
            type="text"
            defaultValue={quoteSearch}
            placeholder="VQ-2026-001"
            className="mt-1 rounded-md border border-veridan-warm-gray-light px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-veridan-ink px-3 py-1.5 text-sm font-medium text-veridan-paper hover:bg-veridan-ink/90"
        >
          Filter
        </button>
        {quoteSearch && (
          <Link href="/admin/overrides" className="text-sm text-veridan-warm-gray underline underline-offset-2">
            Clear
          </Link>
        )}
      </form>

      <section className="mt-6">
        {overrides.length === 0 ? (
          <InstructiveMessage
            title={quoteSearch ? "No overrides match that quote" : "No overrides recorded"}
            body={
              quoteSearch
                ? "Try a different quote reference, or clear the filter to see every override."
                : "This is a good sign — no quote has needed a margin-below-tier, margin-below-floor, or price-below-landed-cost override yet."
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[820px] table-auto border-collapse text-left">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Who</th>
                  <th className="px-3 py-2">Quote</th>
                  <th className="px-3 py-2">Breach type</th>
                  <th className="px-3 py-2 text-right">Requested margin</th>
                  <th className="px-3 py-2 text-right">Landed / quoted (USD)</th>
                  <th className="px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((row) => (
                  <tr key={row.id} className="border-b border-veridan-warm-gray-light align-top last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-veridan-ink">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-veridan-ink">
                      {row.users?.display_name || row.users?.email || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm">
                      {row.quotes ? (
                        <Link
                          href={`/admin/quotes/${row.quotes.id}`}
                          className="font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
                        >
                          {row.quotes.quote_ref}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-veridan-ink">
                      {OVERRIDE_TYPE_LABELS[row.override_type]}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm text-veridan-ink">
                      {formatPct(row.requested_margin_pct)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-sm text-veridan-ink">
                      {row.landed_cost_usd != null || row.quoted_price_usd != null
                        ? `${formatUsd(row.landed_cost_usd)} / ${formatUsd(row.quoted_price_usd)}`
                        : "—"}
                    </td>
                    <td className="max-w-xs px-3 py-2 text-sm text-veridan-warm-gray">{row.reason}</td>
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

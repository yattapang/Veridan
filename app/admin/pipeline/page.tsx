import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { KpiTiles } from "@/components/admin/KpiTiles";
import { EarlyWarningBanners } from "@/components/admin/EarlyWarningBanners";
import { fetchDashboardKpis, fetchPipelineRows } from "@/lib/pipeline-data";
import { groupByStage, PIPELINE_STAGES, type PipelineStage } from "@/lib/pipeline";
import type { PipelineViewRow } from "@/lib/supabase/types";
import { formatJmd } from "@/lib/quotes/format";

export const metadata = {
  title: "Pipeline",
};

const PATHWAY_LABELS: Record<string, string> = {
  new_construction: "New construction",
  retrofit: "Retrofit",
};

// PIPELINE_STAGES never actually contains "Unknown" (see lib/pipeline.ts),
// but it's typed as PipelineStage[] so this map needs every key to index
// safely without a cast.
const STAGE_COLUMN_TONE: Record<PipelineStage, string> = {
  Enquiry: "border-t-veridan-warm-gray",
  "Technical Review": "border-t-blue-400",
  "Quote Drafted": "border-t-veridan-warm-gray",
  Sent: "border-t-blue-500",
  Accepted: "border-t-green-500",
  Declined: "border-t-red-400",
  Fulfilled: "border-t-veridan-ink",
  Unknown: "border-t-veridan-warm-gray",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function cardHref(row: PipelineViewRow): string {
  if (row.quote_id) return `/admin/quotes/${row.quote_id}`;
  if (row.project_id) return `/admin/projects/${row.project_id}`;
  return `/admin/enquiries/${row.enquiry_id}`;
}

export default async function PipelinePage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Pipeline</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const [{ rows, error: pipelineError }, kpis] = await Promise.all([
    fetchPipelineRows(supabase),
    fetchDashboardKpis(supabase),
  ]);

  if (pipelineError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Pipeline</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`pipeline_view couldn't be loaded (${pipelineError}). Check that the Supabase project is running and every migration in supabase/migrations has been applied, then reload.`}
        />
      </div>
    );
  }

  const grouped = groupByStage(rows);

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Pipeline</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Every enquiry, tracked through to fulfillment. Stage is derived automatically from
        enquiry, quote, and project status — no separate status to keep in sync.
      </p>

      <div className="mt-6">
        <EarlyWarningBanners kpis={kpis} />
        <KpiTiles kpis={kpis} />
      </div>

      <section className="mt-8">
        {rows.length === 0 ? (
          <InstructiveMessage
            title="Nothing in the pipeline yet"
            body="Once a quote request comes in through the portal, it will appear here as an Enquiry card and move right as it progresses."
          />
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage} className="w-72 shrink-0">
                <div
                  className={`rounded-t-md border-t-4 bg-veridan-warm-gray-pale/60 px-3 py-2 ${STAGE_COLUMN_TONE[stage]}`}
                >
                  <p className="text-sm font-semibold text-veridan-ink">{stage}</p>
                  <p className="text-xs text-veridan-warm-gray">{grouped[stage].length} in stage</p>
                </div>
                <div className="flex flex-col gap-2 rounded-b-md border border-t-0 border-veridan-warm-gray-light bg-white p-2 min-h-[4rem]">
                  {grouped[stage].length === 0 ? (
                    <p className="px-2 py-3 text-xs text-veridan-warm-gray">Empty</p>
                  ) : (
                    grouped[stage].map((row) => (
                      <Link
                        key={row.enquiry_id}
                        href={cardHref(row)}
                        className="rounded-md border border-veridan-warm-gray-light px-3 py-2 text-sm hover:border-veridan-accent hover:bg-veridan-warm-gray-pale/40"
                      >
                        <p className="truncate font-medium text-veridan-ink">
                          {row.company_name || row.contact_name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-veridan-warm-gray">
                          {row.quote_ref
                            ? row.quote_ref
                            : PATHWAY_LABELS[row.pathway] ?? row.pathway}
                        </p>
                        <p className="mt-1 flex items-center justify-between text-xs text-veridan-warm-gray">
                          <span>{formatDate(row.enquiry_created_at)}</span>
                          {row.total_client_jmd != null && (
                            <span className="font-medium text-veridan-ink">
                              {formatJmd(row.total_client_jmd)}
                            </span>
                          )}
                        </p>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { KpiTiles } from "@/components/admin/KpiTiles";
import { EarlyWarningBanners } from "@/components/admin/EarlyWarningBanners";
import { fetchDashboardKpis, fetchPipelineRows, fetchRecentActivity } from "@/lib/pipeline-data";
import { groupByStage, PIPELINE_STAGES } from "@/lib/pipeline";

export const metadata = {
  title: "Dashboard",
};

const ACTIVITY_ICON: Record<string, string> = {
  enquiry_received: "New",
  quote_sent: "Sent",
  quote_accepted: "Won",
};

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
 * Admin dashboard (Task 21) — assembles the pipeline snapshot, KPI tiles,
 * and early-warning flags built for Task 20 (extracted to lib/kpis.ts +
 * lib/pipeline-data.ts so this page and /admin/pipeline never compute the
 * same number two different ways), plus a recent-activity feed and quick
 * links. Replaces the Task 5 placeholder.
 */
export default async function AdminDashboardPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Dashboard</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const [{ rows: pipelineRows, error: pipelineError }, kpis, { items: activity, error: activityError }] =
    await Promise.all([fetchPipelineRows(supabase), fetchDashboardKpis(supabase), fetchRecentActivity(supabase)]);

  if (pipelineError && kpis.error) {
    return (
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Dashboard</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The dashboard couldn't load (${pipelineError}). Check that the Supabase project is running and every migration in supabase/migrations has been applied, then reload.`}
        />
      </div>
    );
  }

  const grouped = pipelineError ? null : groupByStage(pipelineRows);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Dashboard</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Where things stand across every enquiry, quote, and order.
      </p>

      <div className="mt-6">
        {kpis.error ? (
          <InstructiveMessage title="KPI tiles unavailable" body={`Could not compute KPIs (${kpis.error}).`} />
        ) : (
          <>
            <EarlyWarningBanners kpis={kpis} />
            <KpiTiles kpis={kpis} />
          </>
        )}
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Pipeline snapshot
          </h2>
          <Link
            href="/admin/pipeline"
            className="text-sm font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            View full pipeline
          </Link>
        </div>
        {grouped == null ? (
          <InstructiveMessage
            title="Pipeline unavailable"
            body={`Could not load the pipeline snapshot (${pipelineError}).`}
          />
        ) : pipelineRows.length === 0 ? (
          <InstructiveMessage
            title="Nothing in the pipeline yet"
            body="Once a quote request comes in through the portal, it will show up here."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {PIPELINE_STAGES.map((stage) => (
              <Link
                key={stage}
                href="/admin/pipeline"
                className="rounded-md border border-veridan-warm-gray-light bg-white px-3 py-3 text-center hover:border-veridan-accent"
              >
                <p className="text-2xl font-semibold text-veridan-ink">{grouped[stage].length}</p>
                <p className="mt-1 text-xs text-veridan-warm-gray">{stage}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Recent activity
          </h2>
          {activityError ? (
            <InstructiveMessage title="Activity unavailable" body={`Could not load activity (${activityError}).`} />
          ) : activity.length === 0 ? (
            <InstructiveMessage title="No activity yet" body="Enquiries and quote sends/accepts will show up here." />
          ) : (
            <ul className="flex flex-col gap-2">
              {activity.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-start gap-3 rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 hover:border-veridan-accent"
                  >
                    <span className="mt-0.5 shrink-0 rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray">
                      {ACTIVITY_ICON[item.type] ?? item.type}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-veridan-ink">{item.label}</span>
                      <span className="block text-xs text-veridan-warm-gray">{formatDateTime(item.atIso)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Quick links
          </h2>
          <ul className="flex flex-col gap-2">
            <li>
              <Link
                href="/admin/quotes"
                className="block rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink hover:border-veridan-accent"
              >
                Quotes &mdash; create a new one from a project
              </Link>
            </li>
            <li>
              <Link
                href="/admin/enquiries"
                className="block rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink hover:border-veridan-accent"
              >
                Enquiries &mdash; review and convert
              </Link>
            </li>
            <li>
              <Link
                href="/admin/parameters"
                className="block rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink hover:border-veridan-accent"
              >
                Parameters &mdash; rates, tiers, defaults
              </Link>
            </li>
            <li>
              <Link
                href="/admin/overrides"
                className="block rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink hover:border-veridan-accent"
              >
                Overrides &mdash; margin/floor override log
              </Link>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}

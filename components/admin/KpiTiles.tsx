import type { DashboardKpis } from "@/lib/pipeline-data";
import { formatJmd, formatUsd } from "@/lib/quotes/format";

/**
 * KPI tile row (Task 20, reused by Task 21's /admin dashboard). Presentational
 * only — all arithmetic lives in lib/kpis.ts / lib/pipeline-data.ts so this
 * component just formats the already-computed numbers.
 */
function formatPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

function formatDays(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(1)} days`;
}

function quarterLabel(range: DashboardKpis["quarterRange"]): string {
  const q = Math.floor((Number(range.startIso.slice(5, 7)) - 1) / 3) + 1;
  const year = range.startIso.slice(0, 4);
  return `Q${q} ${year}`;
}

export function KpiTiles({ kpis }: { kpis: DashboardKpis }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
          Quote-to-order conversion ({quarterLabel(kpis.quarterRange)})
        </p>
        <p className="mt-1 text-2xl font-semibold text-veridan-ink">
          {formatPercent(kpis.conversion.conversionPct)}
        </p>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          {kpis.conversion.acceptedCount} accepted of {kpis.conversion.resolvedCount} resolved
        </p>
      </div>

      <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
          Enquiry &rarr; first quote sent
        </p>
        <p className="mt-1 text-2xl font-semibold text-veridan-ink">
          {formatDays(kpis.turnaroundBusinessDays)}
        </p>
        <p className="mt-1 text-xs text-veridan-warm-gray">Average, business days (weekends excluded)</p>
      </div>

      <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
          Average accepted order value
        </p>
        <p className="mt-1 text-2xl font-semibold text-veridan-ink">
          {formatJmd(kpis.averageOrderValue.avgJmd)}
        </p>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          {formatUsd(kpis.averageOrderValue.avgUsd)} &middot; {kpis.averageOrderValue.count} accepted quote
          {kpis.averageOrderValue.count === 1 ? "" : "s"}
        </p>
      </div>
    </div>
  );
}

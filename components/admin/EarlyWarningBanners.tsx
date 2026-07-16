import Link from "next/link";
import type { DashboardKpis } from "@/lib/pipeline-data";

/**
 * Early-warning banners (PRD §8/§9.2, Task 20, reused by Task 21). Two
 * independent flags, each rendered only when tripped:
 * - Conversion: last two full calendar months both below 25% (amber).
 * - Margin: any accepted quote's effective margin below the 20% floor (red
 *   — a realized-margin breach is worse than a soft conversion dip).
 */
export function EarlyWarningBanners({ kpis }: { kpis: DashboardKpis }) {
  if (!kpis.conversionEarlyWarning && kpis.marginBreaches.length === 0) return null;

  return (
    <div className="mb-6 flex flex-col gap-3">
      {kpis.conversionEarlyWarning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Conversion below 25% for two months running</p>
          <p className="mt-0.5 text-amber-800">
            Quote-to-order conversion has been under 25% in each of the last two full calendar
            months. Worth a look at pricing, follow-up cadence, or the quality of enquiries coming
            in.
          </p>
        </div>
      )}
      {kpis.marginBreaches.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">
            {kpis.marginBreaches.length} accepted order{kpis.marginBreaches.length === 1 ? "" : "s"} below
            the 20% margin floor
          </p>
          <ul className="mt-1 list-inside list-disc text-red-800">
            {kpis.marginBreaches.map((b) => (
              <li key={b.id}>
                <Link href={`/admin/quotes/${b.id}`} className="underline underline-offset-2">
                  {b.quote_ref}
                </Link>{" "}
                &mdash; effective margin {b.effectiveMarginPct.toFixed(1)}%
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

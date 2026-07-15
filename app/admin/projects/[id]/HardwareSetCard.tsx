import Link from "next/link";
import type { HardwareSetRow } from "@/lib/supabase/types";
import type { HardwareSetUsdSummary } from "@/lib/hardware-sets";

function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function HardwareSetCard({
  projectId,
  set,
  summary,
}: {
  projectId: string;
  set: HardwareSetRow;
  summary: HardwareSetUsdSummary;
}) {
  return (
    <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
      <Link
        href={`/admin/projects/${projectId}/hardware-sets/${set.id}`}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div>
          <p className="text-sm font-medium text-veridan-ink">
            {set.code}
            {set.name ? ` — ${set.name}` : ""}
          </p>
          <p className="mt-1 text-xs text-veridan-warm-gray">
            {summary.lineCount} line item{summary.lineCount === 1 ? "" : "s"}
            {set.cloned_from_set_id ? " · cloned" : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-veridan-ink">
            {summary.lineCount === 0 ? "—" : formatUsd(summary.subtotalUsd)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-veridan-warm-gray">
            Indicative supplier cost{summary.incomplete ? " · partial" : ""}
          </p>
        </div>
      </Link>
    </li>
  );
}

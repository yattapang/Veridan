"use client";

import { useActionState } from "react";
import type { OriginResult } from "@/lib/landed-cost/types";
import type { QuoteOriginRow } from "@/lib/supabase/types";
import { formatUsd } from "@/lib/quotes/format";
import { initialOriginActionResult, updateQuoteOrigin } from "./actions";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-2 py-1.5 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none disabled:bg-veridan-warm-gray-pale disabled:text-veridan-warm-gray";
const labelClass = "block text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray";

function numValue(v: number | null): string | number {
  return v == null ? "" : v;
}

/**
 * One shipment origin's cost-pool editor. Left: editable inputs (all default
 * from the parameters snapshot, blank = "let the engine default it"). Right:
 * the engine's computed CIF basis / duty / total shipment cost for this pool.
 * Read-only once the quote leaves draft.
 */
export function QuoteOriginCard({
  quoteId,
  origin,
  computed,
  isDraft,
}: {
  quoteId: string;
  origin: QuoteOriginRow;
  computed: OriginResult | undefined;
  isDraft: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateQuoteOrigin.bind(null, quoteId, origin.id),
    initialOriginActionResult
  );

  return (
    <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-veridan-ink">{origin.origin_label}</h3>
        {computed?.usedFallbackFreight && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
            $1,250 freight fallback
          </span>
        )}
        {computed?.skipped && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-700">
            Skipped — zero value
          </span>
        )}
      </div>

      <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor={`freight-${origin.id}`}>
            Freight/export fees (USD)
          </label>
          <input id={`freight-${origin.id}`} type="number" step="0.01" min="0" name="freight_export_fees_usd" defaultValue={numValue(origin.freight_export_fees_usd)} disabled={!isDraft} className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`ocean-${origin.id}`}>
            Ocean freight (USD)
          </label>
          <input id={`ocean-${origin.id}`} type="number" step="0.01" min="0" name="ocean_freight_usd" defaultValue={numValue(origin.ocean_freight_usd)} placeholder="blank → $1,250 fallback" disabled={!isDraft} className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`insurance-${origin.id}`}>
            Marine insurance (USD)
          </label>
          <input id={`insurance-${origin.id}`} type="number" step="0.01" min="0" name="marine_insurance_usd" defaultValue={numValue(origin.marine_insurance_usd)} placeholder="blank → 1.5% of CIF" disabled={!isDraft} className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`pallets-${origin.id}`}>
            Pallet count
          </label>
          <input id={`pallets-${origin.id}`} type="number" step="1" min="1" name="pallet_count" defaultValue={origin.pallet_count} disabled={!isDraft} className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`brokerage-${origin.id}`}>
            Brokerage (USD)
          </label>
          <input id={`brokerage-${origin.id}`} type="number" step="0.01" min="0" name="brokerage_usd" defaultValue={numValue(origin.brokerage_usd)} placeholder="blank → formula" disabled={!isDraft} className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`port-${origin.id}`}>
            Port handling (USD)
          </label>
          <input id={`port-${origin.id}`} type="number" step="0.01" min="0" name="port_handling_usd" defaultValue={numValue(origin.port_handling_usd)} placeholder="blank → snapshot default" disabled={!isDraft} className={`${inputClass} mt-1`} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`duty-${origin.id}`}>
            Duty + GCT (%)
          </label>
          <input id={`duty-${origin.id}`} type="number" step="0.01" min="0" max="100" name="duty_gct_pct" defaultValue={numValue(origin.duty_gct_pct)} placeholder="blank → snapshot default" disabled={!isDraft} className={`${inputClass} mt-1`} />
        </div>
        {isDraft && (
          <div className="flex items-end sm:col-span-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-veridan-ink px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Recomputing…" : "Save & recompute"}
            </button>
          </div>
        )}
        {state.ok === false && (
          <p role="alert" className="sm:col-span-3 text-xs text-red-600">
            {state.error}
          </p>
        )}
      </form>

      {computed && !computed.skipped && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-veridan-warm-gray-light pt-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-veridan-warm-gray">Supplier invoice</dt>
            <dd className="font-medium text-veridan-ink">{formatUsd(computed.supplierInvoiceTotalUsd)}</dd>
          </div>
          <div>
            <dt className="text-veridan-warm-gray">CIF basis</dt>
            <dd className="font-medium text-veridan-ink">{formatUsd(computed.cifBasisUsd)}</dd>
          </div>
          <div>
            <dt className="text-veridan-warm-gray">Duty + GCT</dt>
            <dd className="font-medium text-veridan-ink">{formatUsd(computed.dutyGctUsd)}</dd>
          </div>
          <div>
            <dt className="text-veridan-warm-gray">Total shipment cost</dt>
            <dd className="font-medium text-veridan-ink">{formatUsd(computed.totalShipmentCostUsd)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

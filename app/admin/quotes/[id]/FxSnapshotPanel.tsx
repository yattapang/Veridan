"use client";

import { useState, useTransition } from "react";
import type { FxSnapshotStored } from "@/lib/supabase/types";
import { refreshFxSnapshot } from "./actions";

/**
 * Shows the quote's locked FX snapshot (bank sell rate, buffer, and the
 * derived effective rate rendered transparently as "162.00 × 1.03 = 166.86"),
 * plus supplier conversion rates. The "refresh from current parameters"
 * action is available ONLY in draft — a sent quote's FX is locked (§6.3.6).
 */
export function FxSnapshotPanel({
  quoteId,
  fx,
  isDraft,
}: {
  quoteId: string;
  fx: FxSnapshotStored;
  isDraft: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRefresh() {
    setError(null);
    startTransition(async () => {
      const result = await refreshFxSnapshot(quoteId);
      if (!result.ok) setError(result.error);
    });
  }

  const supplierRates = Object.entries(fx.supplier_rates ?? {});

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-veridan-ink">
            <span className="font-medium">Effective JMD rate:</span>{" "}
            {fx.bank_sell_rate.toFixed(2)} × {(1 + fx.fx_buffer_pct / 100).toFixed(2)} ={" "}
            <span className="font-semibold">{fx.effective_rate.toFixed(2)}</span>
          </p>
          <p className="mt-1 text-xs text-veridan-warm-gray">
            Bank sell rate {fx.bank_sell_rate.toFixed(2)} + {fx.fx_buffer_pct}% risk buffer · as of{" "}
            {fx.as_of} · {fx.source}
          </p>
        </div>
        {isDraft && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={pending}
            className="shrink-0 rounded-md border border-veridan-warm-gray-light px-3 py-1.5 text-xs font-medium text-veridan-ink transition-colors duration-150 hover:bg-veridan-warm-gray-pale disabled:opacity-50"
          >
            {pending ? "Refreshing…" : "Refresh snapshot from current parameters"}
          </button>
        )}
      </div>

      {supplierRates.length > 0 && (
        <p className="mt-3 text-xs text-veridan-warm-gray">
          Supplier rates (USD per 1 native unit):{" "}
          {supplierRates.map(([code, rate]) => `${code} ${rate}`).join(" · ")}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

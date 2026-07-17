"use client";

import { useActionState, useState } from "react";
import { formatJmd, formatUsd, OVERRIDE_TYPE_LABELS } from "@/lib/quotes/format";
import { updateQuoteMargin, type MarginActionResult } from "./actions";

const initialMarginActionResult: MarginActionResult = { ok: true };

export interface MarginLine {
  lineId: string;
  label: string;
  doorLabel: string;
  landedCostUsd: number;
  marginPct: number;
  clientPriceUsd: number;
  clientPriceJmd: number;
  currentOverride: number | null;
}

export interface PackagePrice {
  setCode: string;
  setName: string | null;
  doorCount: number;
  perDoorLandedUsd: number;
  perDoorClientJmd: number;
  varies: boolean;
}

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-2 py-1.5 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none disabled:bg-veridan-warm-gray-pale disabled:text-veridan-warm-gray";

/**
 * Margin selection + the §6.3.5 floor/override gate + totals. Selecting a
 * margin and pressing "Apply pricing" runs the engine server-side BEFORE
 * saving; if it breaches the floor the server returns the flags without
 * saving and this panel reveals a reason field. Confirming with a reason
 * saves the margin and logs the override.
 */
export function MarginPanel({
  quoteId,
  isDraft,
  tiers,
  currentMargin,
  effectiveRate,
  bankSellRate,
  fxBufferPct,
  lines,
  packages,
  totals,
}: {
  quoteId: string;
  isDraft: boolean;
  tiers: number[];
  currentMargin: number;
  effectiveRate: number;
  bankSellRate: number;
  fxBufferPct: number;
  lines: MarginLine[];
  packages: PackagePrice[];
  totals: { landedCostUsd: number; clientPriceUsd: number; clientPriceJmd: number };
}) {
  const [state, formAction, pending] = useActionState(
    updateQuoteMargin.bind(null, quoteId),
    initialMarginActionResult
  );
  const [margin, setMargin] = useState<string>(String(currentMargin));

  const requiresOverride = state.ok === false && state.requiresOverride === true;

  return (
    <form action={formAction}>
      {/* Tier selection */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="margin_pct">
            Margin %
          </label>
          <input
            id="margin_pct"
            name="margin_pct"
            type="number"
            step="0.01"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            disabled={!isDraft}
            className={`${inputClass} mt-1 w-28`}
          />
        </div>
        {isDraft && (
          <div className="flex gap-2">
            {tiers.map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setMargin(String(tier))}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                  Number(margin) === tier
                    ? "border-veridan-ink bg-veridan-ink text-veridan-paper"
                    : "border-veridan-warm-gray-light text-veridan-ink hover:bg-veridan-warm-gray-pale"
                }`}
              >
                {tier}%
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Per-line pricing + optional per-line override */}
      {lines.length > 0 && (
        <div className="mt-5 overflow-x-auto rounded-md border border-veridan-warm-gray-light">
          <table className="w-full min-w-[720px] table-auto border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                <th className="px-3 py-2">Line</th>
                <th className="px-3 py-2 text-right">Landed USD</th>
                <th className="px-3 py-2 text-right">Margin</th>
                <th className="px-3 py-2 text-right">Client USD</th>
                <th className="px-3 py-2 text-right">Client JMD</th>
                <th className="px-3 py-2">Override %</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.lineId} className="border-b border-veridan-warm-gray-light last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="text-veridan-ink">{line.label}</span>
                    <span className="ml-1 text-xs text-veridan-warm-gray">{line.doorLabel}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-veridan-ink">{formatUsd(line.landedCostUsd)}</td>
                  <td className="px-3 py-2 text-right text-veridan-warm-gray">{line.marginPct}%</td>
                  <td className="px-3 py-2 text-right text-veridan-ink">{formatUsd(line.clientPriceUsd)}</td>
                  <td className="px-3 py-2 text-right font-medium text-veridan-ink">{formatJmd(line.clientPriceJmd, 2)}</td>
                  <td className="px-3 py-2">
                    <input
                      name={`margin_override__${line.lineId}`}
                      type="number"
                      step="0.01"
                      defaultValue={line.currentOverride ?? ""}
                      placeholder="tier"
                      disabled={!isDraft}
                      className={`${inputClass} w-20`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-door package pricing (door_register) */}
      {packages.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Per-door package pricing
          </h3>
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white">
            {packages.map((pkg) => (
              <li
                key={pkg.setCode}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-veridan-warm-gray-light px-4 py-2 text-sm last:border-b-0"
              >
                <span className="text-veridan-ink">
                  <span className="font-medium">{pkg.setCode}</span>
                  {pkg.setName ? ` — ${pkg.setName}` : ""} × {pkg.doorCount} door
                  {pkg.doorCount === 1 ? "" : "s"}
                </span>
                <span className="text-veridan-warm-gray">
                  Landed {formatUsd(pkg.perDoorLandedUsd)} ·{" "}
                  <span className="font-semibold text-veridan-ink">{formatJmd(pkg.perDoorClientJmd)}/door</span>
                  {pkg.varies && <span className="ml-1 text-amber-700">(prices vary — check lines)</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Totals */}
      <dl className="mt-5 grid grid-cols-1 gap-3 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale/40 px-5 py-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-veridan-warm-gray">Total landed cost</dt>
          <dd className="text-lg font-semibold text-veridan-ink">{formatUsd(totals.landedCostUsd)}</dd>
        </div>
        <div>
          <dt className="text-xs text-veridan-warm-gray">Total client price (USD)</dt>
          <dd className="text-lg font-semibold text-veridan-ink">{formatUsd(totals.clientPriceUsd)}</dd>
        </div>
        <div>
          <dt className="text-xs text-veridan-warm-gray">
            Total client price (JMD) · {bankSellRate.toFixed(2)} × {(1 + fxBufferPct / 100).toFixed(2)} ={" "}
            {effectiveRate.toFixed(2)}
          </dt>
          <dd className="text-lg font-semibold text-veridan-ink">{formatJmd(totals.clientPriceJmd)}</dd>
        </div>
      </dl>

      {/* Override gate */}
      {state.ok === false && state.requiresOverride === true && state.flags && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-800">Override required before this pricing can be saved</p>
          <ul className="mt-2 space-y-1 text-xs text-amber-800">
            {state.flags.map((flag) => (
              <li key={flag.type}>
                {OVERRIDE_TYPE_LABELS[flag.type]} — {flag.lineCount} line
                {flag.lineCount === 1 ? "" : "s"}, lowest margin {flag.minMarginPct}%.
              </li>
            ))}
          </ul>
          <label className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-amber-800" htmlFor="override_reason">
            Override reason (recorded with your name, visible to both founders)
          </label>
          <textarea
            id="override_reason"
            name="override_reason"
            rows={2}
            required
            className="mt-1 w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm text-veridan-ink focus:border-amber-500 focus:outline-none"
          />
        </div>
      )}

      {state.ok === false && state.requiresOverride !== true && (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {state.error}
        </p>
      )}
      {state.ok === false && state.requiresOverride === true && (
        <p role="alert" className="mt-2 text-xs text-amber-800">
          {state.error}
        </p>
      )}

      {isDraft && (
        <div className="mt-4">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Applying…" : requiresOverride ? "Confirm override & save" : "Apply pricing & recompute"}
          </button>
        </div>
      )}
    </form>
  );
}

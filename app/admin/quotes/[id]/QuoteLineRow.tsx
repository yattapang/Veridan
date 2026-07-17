"use client";

import { useActionState, useState, useTransition } from "react";
import { CURRENCY_CODES, type QuoteLineItemWithDetails, type SupplierRow } from "@/lib/supabase/types";
import { formatUsd } from "@/lib/quotes/format";
import { deleteQuoteLine, updateQuoteLine } from "./lineItemActions";
import { initialQuoteLineActionResult } from "./lineItemActionState";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/** One line_item-mode quote line, with inline edit/remove (Task 17). */
export function QuoteLineRow({
  quoteId,
  line,
  suppliers,
  landedCostUsd,
  clientPriceUsd,
  clientPriceJmd,
  isDraft,
}: {
  quoteId: string;
  line: QuoteLineItemWithDetails;
  suppliers: SupplierRow[];
  landedCostUsd: number | null;
  clientPriceUsd: number | null;
  clientPriceJmd: number | null;
  isDraft: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [state, formAction, formPending] = useActionState(
    updateQuoteLine.bind(null, quoteId, line.id),
    initialQuoteLineActionResult
  );

  const label = line.products?.description ?? line.description_override ?? "Line item";
  const isAdHoc = !line.product_id;

  function handleDelete() {
    if (!window.confirm(`Remove "${label}" from this quote?`)) return;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteQuoteLine(quoteId, line.id);
      if (!result.ok) setDeleteError(result.error);
    });
  }

  if (editing) {
    return (
      <tr className="border-b border-veridan-warm-gray-light last:border-b-0">
        <td colSpan={6} className="px-4 py-4">
          <form action={formAction} className="grid gap-3 sm:grid-cols-5">
            {isAdHoc ? (
              <div className="sm:col-span-5">
                <label className={labelClass} htmlFor={`desc-${line.id}`}>
                  Description
                </label>
                <input
                  id={`desc-${line.id}`}
                  type="text"
                  name="description"
                  defaultValue={line.description_override ?? ""}
                  required
                  className={`${inputClass} mt-1`}
                />
              </div>
            ) : (
              <p className="text-sm font-medium text-veridan-ink sm:col-span-5">{label}</p>
            )}
            <div>
              <label className={labelClass} htmlFor={`supplier-${line.id}`}>
                Supplier
              </label>
              <select
                id={`supplier-${line.id}`}
                name="supplier_id"
                defaultValue={line.supplier_id ?? ""}
                className={`${inputClass} mt-1`}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor={`qty-${line.id}`}>
                Qty
              </label>
              <input
                id={`qty-${line.id}`}
                type="number"
                name="qty"
                step="any"
                min="0.01"
                defaultValue={line.qty}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`cost-${line.id}`}>
                Unit cost
              </label>
              <input
                id={`cost-${line.id}`}
                type="number"
                name="unit_cost"
                step="any"
                min="0"
                defaultValue={line.unit_cost}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`currency-${line.id}`}>
                Currency
              </label>
              <select id={`currency-${line.id}`} name="cost_currency" defaultValue={line.cost_currency} className={`${inputClass} mt-1`}>
                {CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-3 sm:col-span-5">
              <button
                type="submit"
                disabled={formPending}
                className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
              >
                {formPending ? "Saving…" : "Save line"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
              >
                Cancel
              </button>
              {state.ok === false && (
                <p role="alert" className="text-xs text-red-600">
                  {state.error}
                </p>
              )}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-veridan-warm-gray-light last:border-b-0">
      <td className="px-4 py-2 text-veridan-ink">
        {label}
        {isAdHoc && <span className="ml-2 rounded-full bg-veridan-warm-gray-pale px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-veridan-warm-gray">ad-hoc</span>}
        <p className="text-xs text-veridan-warm-gray">{line.suppliers?.name ?? "Unknown supplier"}</p>
        {deleteError && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {deleteError}
          </p>
        )}
      </td>
      <td className="px-4 py-2 text-right text-veridan-warm-gray">{line.qty}</td>
      <td className="px-4 py-2 text-right text-veridan-ink">{formatUsd(landedCostUsd ?? line.landed_cost_usd)}</td>
      <td className="px-4 py-2 text-right text-veridan-ink">{clientPriceUsd != null ? formatUsd(clientPriceUsd) : "—"}</td>
      <td className="px-4 py-2 text-right font-medium text-veridan-ink">
        {clientPriceJmd != null ? `J$${clientPriceJmd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
      </td>
      <td className="px-4 py-2 text-right">
        {isDraft && (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink disabled:opacity-50"
            >
              {pending ? "Removing…" : "Remove"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

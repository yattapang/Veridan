"use client";

import { useActionState, useState, useTransition } from "react";
import { CURRENCY_CODES, type HardwareSetLineItemWithDetails, type SupplierRow } from "@/lib/supabase/types";
import { resolveLineCost, toUsdIndicative, type SupplierFxRates } from "@/lib/hardware-sets";
import { deleteLineItem, initialLineItemActionResult, updateLineItem } from "./actions";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export function LineItemRow({
  projectId,
  setId,
  line,
  suppliers,
  fxRates,
}: {
  projectId: string;
  setId: string;
  line: HardwareSetLineItemWithDetails;
  suppliers: SupplierRow[];
  fxRates: SupplierFxRates;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [state, formAction, formPending] = useActionState(
    updateLineItem.bind(null, projectId, setId, line.id),
    initialLineItemActionResult
  );

  const resolved = resolveLineCost(line);
  const usdEach = resolved ? toUsdIndicative(resolved.unitCost, resolved.currency, fxRates) : null;
  const usdLine = usdEach != null ? usdEach * Number(line.qty) : null;

  function handleDelete() {
    if (!window.confirm(`Remove ${line.products?.description ?? "this line"} from the set?`)) return;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteLineItem(projectId, setId, line.id);
      if (!result.ok) setDeleteError(result.error);
    });
  }

  if (editing) {
    return (
      <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
        <p className="mb-2 text-sm font-medium text-veridan-ink">{line.products?.description ?? "Unknown product"}</p>
        <form action={formAction} className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className={labelClass} htmlFor={`supplier-${line.id}`}>
              Supplier
            </label>
            <select
              id={`supplier-${line.id}`}
              name="supplier_id"
              defaultValue={line.supplier_id}
              className={`${inputClass} mt-1`}
            >
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
            <label className={labelClass} htmlFor={`override-cost-${line.id}`}>
              Unit cost override
            </label>
            <input
              id={`override-cost-${line.id}`}
              type="number"
              name="unit_cost_override"
              step="any"
              min="0"
              placeholder={`Library: ${line.products?.unit_cost ?? "—"}`}
              defaultValue={line.unit_cost_override ?? ""}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`override-currency-${line.id}`}>
              Override currency
            </label>
            <select
              id={`override-currency-${line.id}`}
              name="cost_currency_override"
              defaultValue={line.cost_currency_override ?? ""}
              className={`${inputClass} mt-1`}
            >
              <option value="">— use library —</option>
              {CURRENCY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <label className={labelClass} htmlFor={`notes-${line.id}`}>
              Notes
            </label>
            <input
              id={`notes-${line.id}`}
              type="text"
              name="notes"
              defaultValue={line.notes ?? ""}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div className="sm:col-span-4 flex items-center gap-3">
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
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-veridan-warm-gray-light py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-veridan-ink">{line.products?.description ?? "Unknown product"}</p>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          {line.suppliers?.name ?? "Unknown supplier"}
          {line.products?.manufacturer ? ` · ${line.products.manufacturer}` : ""}
          {line.products?.product_ref ? ` · ${line.products.product_ref}` : ""}
        </p>
        <p className="mt-1 text-xs text-veridan-ink/70">
          Qty {line.qty} × {resolved ? formatMoney(resolved.unitCost, resolved.currency) : "—"}
          {resolved?.isOverride ? " (override)" : ""}
          {usdLine != null && ` · ≈ ${formatMoney(usdLine, "USD")} indicative`}
        </p>
        {line.notes && <p className="mt-1 text-xs italic text-veridan-warm-gray">{line.notes}</p>}
        {deleteError && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {deleteError}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
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
    </li>
  );
}

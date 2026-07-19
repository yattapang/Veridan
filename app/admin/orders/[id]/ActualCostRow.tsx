"use client";

import { useActionState, useState, useTransition } from "react";
import { ACTUAL_COST_CATEGORIES, type ActualCostWithSupplier, type SupplierRow } from "@/lib/supabase/types";
import { ACTUAL_COST_CATEGORY_LABELS } from "@/lib/orders/format";
import { formatJmd, formatUsd } from "@/lib/quotes/format";
import { deleteActualCost, updateActualCost, type OrderActionResult } from "./actions";

const initialResult: OrderActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/** One actual-cost row, with inline edit/remove — immediate rows, no draft state, freely editable/deletable until the order is closed (caller hides the controls once closed via `canEdit`). */
export function ActualCostRow({
  orderId,
  cost,
  suppliers,
  canEdit,
}: {
  orderId: string;
  cost: ActualCostWithSupplier;
  suppliers: SupplierRow[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [state, formAction, formPending] = useActionState(
    updateActualCost.bind(null, orderId, cost.id),
    initialResult,
  );

  function handleDelete() {
    if (!window.confirm("Remove this actual cost row?")) return;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteActualCost(orderId, cost.id);
      if (!result.ok) setDeleteError(result.error);
    });
  }

  if (editing) {
    return (
      <tr className="border-b border-veridan-warm-gray-light last:border-b-0">
        <td colSpan={6} className="px-4 py-4">
          <form action={formAction} className="grid gap-3 sm:grid-cols-6">
            <div>
              <label className={labelClass} htmlFor={`category-${cost.id}`}>
                Category
              </label>
              <select
                id={`category-${cost.id}`}
                name="category"
                defaultValue={cost.category}
                className={`${inputClass} mt-1`}
              >
                {ACTUAL_COST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {ACTUAL_COST_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor={`usd-${cost.id}`}>
                Amount USD
              </label>
              <input
                id={`usd-${cost.id}`}
                name="amount_usd"
                type="number"
                step="0.01"
                min="0"
                defaultValue={cost.amount_usd ?? ""}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`jmd-${cost.id}`}>
                Amount JMD
              </label>
              <input
                id={`jmd-${cost.id}`}
                name="amount_jmd"
                type="number"
                step="0.01"
                min="0"
                defaultValue={cost.amount_jmd ?? ""}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`date-${cost.id}`}>
                Date incurred
              </label>
              <input
                id={`date-${cost.id}`}
                name="incurred_date"
                type="date"
                defaultValue={cost.incurred_date}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`supplier-${cost.id}`}>
                Supplier
              </label>
              <select
                id={`supplier-${cost.id}`}
                name="supplier_id"
                defaultValue={cost.supplier_id ?? ""}
                className={`${inputClass} mt-1`}
              >
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor={`desc-${cost.id}`}>
                Description
              </label>
              <input
                id={`desc-${cost.id}`}
                name="description"
                type="text"
                defaultValue={cost.description ?? ""}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div className="sm:col-span-6">
              <label className={labelClass} htmlFor={`notes-${cost.id}`}>
                Notes
              </label>
              <input
                id={`notes-${cost.id}`}
                name="notes"
                type="text"
                defaultValue={cost.notes ?? ""}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div className="flex items-center gap-3 sm:col-span-6">
              <button
                type="submit"
                disabled={formPending}
                className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
              >
                {formPending ? "Saving…" : "Save"}
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
        {cost.description || ACTUAL_COST_CATEGORY_LABELS[cost.category]}
        {cost.suppliers && <p className="text-xs text-veridan-warm-gray">{cost.suppliers.name}</p>}
        {deleteError && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {deleteError}
          </p>
        )}
      </td>
      <td className="px-4 py-2 text-veridan-warm-gray">{ACTUAL_COST_CATEGORY_LABELS[cost.category]}</td>
      <td className="px-4 py-2 text-veridan-warm-gray">{cost.incurred_date}</td>
      <td className="px-4 py-2 text-right text-veridan-ink">{cost.amount_usd != null ? formatUsd(cost.amount_usd) : "—"}</td>
      <td className="px-4 py-2 text-right text-veridan-ink">{cost.amount_jmd != null ? formatJmd(cost.amount_jmd, 2) : "—"}</td>
      <td className="px-4 py-2 text-right">
        {canEdit && (
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

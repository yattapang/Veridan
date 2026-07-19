"use client";

import { useActionState } from "react";
import { ACTUAL_COST_CATEGORIES, type SupplierRow } from "@/lib/supabase/types";
import { ACTUAL_COST_CATEGORY_LABELS } from "@/lib/orders/format";
import { addActualCost, type OrderActionResult } from "./actions";

const initialResult: OrderActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

/** Task 53 — add a new actual-cost row. Rows are immediate (no draft state); either currency is accepted, at least one required (enforced server-side, matching the DB check constraint). */
export function ActualCostForm({ orderId, suppliers }: { orderId: string; suppliers: SupplierRow[] }) {
  const [state, formAction, pending] = useActionState(addActualCost.bind(null, orderId), initialResult);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-6">
      <div>
        <label className={labelClass} htmlFor="category">
          Category
        </label>
        <select id="category" name="category" required className={`${inputClass} mt-1`} defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {ACTUAL_COST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {ACTUAL_COST_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="amount_usd">
          Amount USD
        </label>
        <input id="amount_usd" name="amount_usd" type="number" step="0.01" min="0" className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="amount_jmd">
          Amount JMD
        </label>
        <input id="amount_jmd" name="amount_jmd" type="number" step="0.01" min="0" className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="incurred_date">
          Date incurred
        </label>
        <input id="incurred_date" name="incurred_date" type="date" defaultValue={today} className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="supplier_id">
          Supplier
        </label>
        <select id="supplier_id" name="supplier_id" className={`${inputClass} mt-1`} defaultValue="">
          <option value="">—</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="description">
          Description
        </label>
        <input id="description" name="description" type="text" className={`${inputClass} mt-1`} />
      </div>
      <div className="sm:col-span-6">
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <input id="notes" name="notes" type="text" className={`${inputClass} mt-1`} />
      </div>
      <div className="sm:col-span-6">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving…" : "Add actual cost"}
        </button>
        {state.ok === false && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

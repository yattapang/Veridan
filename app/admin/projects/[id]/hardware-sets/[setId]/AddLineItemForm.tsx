"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CURRENCY_CODES, type ProductWithSupplier, type SupplierRow } from "@/lib/supabase/types";
import { addLineItem, initialLineItemActionResult } from "./actions";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Product selection + add-to-set form (Task 14). Search results are
 * fetched server-side by the page (searchParams `pq`, reusing the
 * Hardware Library search pattern from app/admin/products/page.tsx) and
 * passed in here; selecting one is a client-side pick from that already-
 * fetched list — mirrors ConvertForm's company picker.
 */
export function AddLineItemForm({
  projectId,
  setId,
  products,
  suppliers,
}: {
  projectId: string;
  setId: string;
  products: ProductWithSupplier[];
  suppliers: SupplierRow[];
}) {
  const [state, formAction, pending] = useActionState(
    addLineItem.bind(null, projectId, setId),
    initialLineItemActionResult
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      formRef.current?.reset();
      setSelectedId(null);
    }
    wasPending.current = pending;
  }, [pending, state.ok]);

  const selected = products.find((p) => p.id === selectedId) ?? null;

  return (
    <div>
      {products.length > 0 && (
        <ul className="mb-3 max-h-48 overflow-y-auto rounded-md border border-veridan-warm-gray-light">
          {products.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-pressed={selectedId === p.id}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  selectedId === p.id
                    ? "bg-veridan-ink text-veridan-paper"
                    : "text-veridan-ink hover:bg-veridan-warm-gray-pale"
                }`}
              >
                {p.description}
                <span className="ml-2 text-xs opacity-70">
                  {p.manufacturer ? `${p.manufacturer} · ` : ""}
                  {p.suppliers?.name ?? "no default supplier"} · {p.cost_currency} {p.unit_cost}/{p.unit}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <form ref={formRef} action={formAction} className="grid gap-3 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale px-4 py-4 sm:grid-cols-4">
          <input type="hidden" name="product_id" value={selected.id} />
          <p className="text-sm font-medium text-veridan-ink sm:col-span-4">
            Adding: {selected.description}
          </p>

          <div>
            <label className={labelClass} htmlFor="add-supplier">
              Supplier
            </label>
            <select
              id="add-supplier"
              name="supplier_id"
              defaultValue={selected.supplier_id ?? ""}
              key={selected.id}
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
            <label className={labelClass} htmlFor="add-qty">
              Qty
            </label>
            <input id="add-qty" type="number" name="qty" step="any" min="0.01" defaultValue={1} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className={labelClass} htmlFor="add-override-cost">
              Unit cost override
            </label>
            <input
              id="add-override-cost"
              type="number"
              name="unit_cost_override"
              step="any"
              min="0"
              placeholder={`Library: ${selected.unit_cost}`}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="add-override-currency">
              Override currency
            </label>
            <select id="add-override-currency" name="cost_currency_override" defaultValue="" className={`${inputClass} mt-1`}>
              <option value="">— use library —</option>
              {CURRENCY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <label className={labelClass} htmlFor="add-notes">
              Notes
            </label>
            <input id="add-notes" type="text" name="notes" className={`${inputClass} mt-1`} />
          </div>
          <div className="sm:col-span-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Adding…" : "Add to set"}
            </button>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
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
      )}
    </div>
  );
}

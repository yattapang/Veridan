"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CURRENCY_CODES, type ProductWithSupplier, type SupplierRow } from "@/lib/supabase/types";
import { siblingAffordanceText, siblingsInGroup } from "@/lib/item-groups";
import { addAdHocQuoteLine, addLibraryQuoteLine } from "./lineItemActions";
import { initialQuoteLineActionResult } from "./lineItemActionState";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Adds a line to a line_item-mode quote (Task 17) — either picked from the
 * Hardware Library (mirrors AddLineItemForm.tsx's search-then-pick pattern
 * from the hardware-set builder) or a free-text ad-hoc line with a manual
 * cost/currency/supplier. Both share the same supplier select, since every
 * line_item-mode line needs one for origin-pool grouping
 * (lib/quotes/persist.ts regroupLineItemOrigins).
 */
export function AddQuoteLineForm({
  quoteId,
  products,
  suppliers,
  siblingsByGroup = {},
}: {
  quoteId: string;
  products: ProductWithSupplier[];
  suppliers: SupplierRow[];
  /** Products sharing an item_group_id with something in `products`, keyed by item_group_id (Task 32). */
  siblingsByGroup?: Record<string, ProductWithSupplier[]>;
}) {
  const [tab, setTab] = useState<"library" | "adhoc">("library");

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("library")}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors duration-150 ${
            tab === "library"
              ? "border-veridan-ink bg-veridan-ink text-veridan-paper"
              : "border-veridan-warm-gray-light text-veridan-ink hover:bg-veridan-warm-gray-pale"
          }`}
        >
          From Hardware Library
        </button>
        <button
          type="button"
          onClick={() => setTab("adhoc")}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors duration-150 ${
            tab === "adhoc"
              ? "border-veridan-ink bg-veridan-ink text-veridan-paper"
              : "border-veridan-warm-gray-light text-veridan-ink hover:bg-veridan-warm-gray-pale"
          }`}
        >
          Ad-hoc line
        </button>
      </div>

      {tab === "library" ? (
        <LibraryPicker quoteId={quoteId} products={products} suppliers={suppliers} siblingsByGroup={siblingsByGroup} />
      ) : (
        <AdHocForm quoteId={quoteId} suppliers={suppliers} />
      )}
    </div>
  );
}

function LibraryPicker({
  quoteId,
  products,
  suppliers,
  siblingsByGroup,
}: {
  quoteId: string;
  products: ProductWithSupplier[];
  suppliers: SupplierRow[];
  siblingsByGroup: Record<string, ProductWithSupplier[]>;
}) {
  const [state, formAction, pending] = useActionState(
    addLibraryQuoteLine.bind(null, quoteId),
    initialQuoteLineActionResult
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSiblings, setShowSiblings] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      formRef.current?.reset();
      setSelectedId(null);
      setShowSiblings(false);
    }
    wasPending.current = pending;
  }, [pending, state.ok]);

  const selected = products.find((p) => p.id === selectedId) ?? null;
  const siblings = selected?.item_group_id
    ? siblingsInGroup(siblingsByGroup[selected.item_group_id] ?? [], selected.item_group_id, selected.id)
    : [];
  const siblingText = siblingAffordanceText(siblings.length);

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
        <form
          ref={formRef}
          action={formAction}
          className="grid gap-3 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale px-4 py-4 sm:grid-cols-4"
        >
          <input type="hidden" name="product_id" value={selected.id} />
          <p className="text-sm font-medium text-veridan-ink sm:col-span-4">Adding: {selected.description}</p>

          {siblingText && (
            <div className="sm:col-span-4">
              <button
                type="button"
                onClick={() => setShowSiblings((v) => !v)}
                className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
              >
                {siblingText} {showSiblings ? "(hide)" : "(show)"}
              </button>
              {showSiblings && (
                <ul className="mt-2 rounded-md border border-veridan-warm-gray-light bg-white text-xs">
                  {siblings.map((s) => (
                    <li key={s.id} className="border-b border-veridan-warm-gray-light px-3 py-1.5 last:border-b-0">
                      {s.suppliers?.name ?? "no supplier"} · {s.finish_code ?? "no finish code"} ·{" "}
                      {s.cost_currency} {s.unit_cost}/{s.unit}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="ql-supplier">
              Supplier
            </label>
            <select
              id="ql-supplier"
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
            <label className={labelClass} htmlFor="ql-qty">
              Qty
            </label>
            <input id="ql-qty" type="number" name="qty" step="any" min="0.01" defaultValue={1} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ql-override-cost">
              Unit cost override
            </label>
            <input
              id="ql-override-cost"
              type="number"
              name="unit_cost_override"
              step="any"
              min="0"
              placeholder={`Library: ${selected.unit_cost}`}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ql-override-currency">
              Override currency
            </label>
            <select id="ql-override-currency" name="cost_currency_override" defaultValue="" className={`${inputClass} mt-1`}>
              <option value="">— use library —</option>
              {CURRENCY_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Adding…" : "Add line"}
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

function AdHocForm({ quoteId, suppliers }: { quoteId: string; suppliers: SupplierRow[] }) {
  const [state, formAction, pending] = useActionState(addAdHocQuoteLine.bind(null, quoteId), initialQuoteLineActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      formRef.current?.reset();
    }
    wasPending.current = pending;
  }, [pending, state.ok]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid gap-3 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale px-4 py-4 sm:grid-cols-4"
    >
      <div className="sm:col-span-4">
        <label className={labelClass} htmlFor="ql-description">
          Description
        </label>
        <input id="ql-description" type="text" name="description" required className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="ql-adhoc-supplier">
          Supplier
        </label>
        <select id="ql-adhoc-supplier" name="supplier_id" defaultValue="" className={`${inputClass} mt-1`}>
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
        <label className={labelClass} htmlFor="ql-adhoc-qty">
          Qty
        </label>
        <input id="ql-adhoc-qty" type="number" name="qty" step="any" min="0.01" defaultValue={1} className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="ql-adhoc-cost">
          Unit cost
        </label>
        <input id="ql-adhoc-cost" type="number" name="unit_cost" step="any" min="0" required className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="ql-adhoc-currency">
          Currency
        </label>
        <select id="ql-adhoc-currency" name="cost_currency" defaultValue="USD" className={`${inputClass} mt-1`}>
          {CURRENCY_CODES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add ad-hoc line"}
        </button>
        {state.ok === false && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

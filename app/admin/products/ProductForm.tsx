"use client";

import { useActionState, useEffect, useRef } from "react";
import { CURRENCY_CODES, PRODUCT_CATEGORIES, type ProductRow, type SupplierRow } from "@/lib/supabase/types";
import {
  createProduct,
  updateProduct,
  initialProductFormResult,
  type ProductFormResult,
} from "./actions";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

const CATEGORY_LABELS: Record<string, string> = {
  locksets: "Locksets",
  closers: "Closers",
  hinges: "Hinges",
  exit_devices: "Exit devices",
  access_control: "Access control",
  ironmongery: "Ironmongery",
  signage: "Signage",
  frames: "Frames",
  other: "Other",
};

/**
 * Shared create/edit form for a Hardware Library product (Task 11).
 * `product` present means edit mode (bound to updateProduct); absent
 * means the "new product" form (bound to createProduct).
 */
export function ProductForm({
  product,
  suppliers,
  onSaved,
}: {
  product?: ProductRow;
  suppliers: SupplierRow[];
  onSaved?: () => void;
}) {
  const action = product ? updateProduct.bind(null, product.id) : createProduct;
  const [state, formAction, pending] = useActionState<ProductFormResult, FormData>(
    action,
    initialProductFormResult
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const idSuffix = product?.id ?? "new";

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      if (!product) formRef.current?.reset();
      onSaved?.();
    }
    wasPending.current = pending;
  }, [pending, state.ok, product, onSaved]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`description-${idSuffix}`}>
          Description
        </label>
        <input
          id={`description-${idSuffix}`}
          type="text"
          name="description"
          required
          defaultValue={product?.description}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`category-${idSuffix}`}>
          Category
        </label>
        <select
          id={`category-${idSuffix}`}
          name="generic_category"
          defaultValue={product?.generic_category ?? "locksets"}
          className={`${inputClass} mt-1`}
        >
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c] ?? c}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor={`manufacturer-${idSuffix}`}>
          Manufacturer
        </label>
        <input
          id={`manufacturer-${idSuffix}`}
          type="text"
          name="manufacturer"
          placeholder="Assa Abloy, Allegion, LCN…"
          defaultValue={product?.manufacturer ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`catalogue-${idSuffix}`}>
          Catalogue ref
        </label>
        <input
          id={`catalogue-${idSuffix}`}
          type="text"
          name="catalogue_ref"
          defaultValue={product?.catalogue_ref ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`product-ref-${idSuffix}`}>
          Product / SKU ref
        </label>
        <input
          id={`product-ref-${idSuffix}`}
          type="text"
          name="product_ref"
          defaultValue={product?.product_ref ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`specified-finish-${idSuffix}`}>
          Specified finish
        </label>
        <input
          id={`specified-finish-${idSuffix}`}
          type="text"
          name="specified_finish"
          placeholder="What the architect's schedule calls for"
          defaultValue={product?.specified_finish ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`supplied-finish-${idSuffix}`}>
          Supplied finish
        </label>
        <input
          id={`supplied-finish-${idSuffix}`}
          type="text"
          name="supplied_finish"
          placeholder="Defaults to Satin Stainless Steel / US32D if left blank"
          defaultValue={product?.supplied_finish ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`supplier-${idSuffix}`}>
          Default supplier
        </label>
        <select
          id={`supplier-${idSuffix}`}
          name="supplier_id"
          defaultValue={product?.supplier_id ?? ""}
          className={`${inputClass} mt-1`}
        >
          <option value="">— none —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor={`unit-${idSuffix}`}>
          Unit
        </label>
        <input
          id={`unit-${idSuffix}`}
          type="text"
          name="unit"
          required
          placeholder="each, set, pair…"
          defaultValue={product?.unit ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`unit-cost-${idSuffix}`}>
          Unit cost
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id={`unit-cost-${idSuffix}`}
            type="number"
            name="unit_cost"
            step="any"
            min="0"
            required
            defaultValue={product?.unit_cost}
            className={inputClass}
          />
          <select
            name="cost_currency"
            defaultValue={product?.cost_currency ?? "USD"}
            className={`${inputClass} max-w-[6.5rem]`}
            aria-label="Cost currency"
          >
            {CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : product ? "Save changes" : "Add product"}
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

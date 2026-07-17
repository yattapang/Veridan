"use client";

import { useActionState, useEffect, useRef } from "react";
import { CURRENCY_CODES, type SupplierRow } from "@/lib/supabase/types";
import {
  createSupplier,
  updateSupplier,
  type SupplierFormResult,
} from "./actions";

const initialSupplierFormResult: SupplierFormResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Shared create/edit form for a supplier (Task 10). `supplier` present
 * means edit mode (bound to updateSupplier); absent means the "new
 * supplier" form (bound to createSupplier). On successful create, the
 * form resets itself via the uncontrolled-input `key` trick in the
 * parent rather than here, keeping this component simple.
 */
export function SupplierForm({
  supplier,
  onSaved,
}: {
  supplier?: SupplierRow;
  onSaved?: () => void;
}) {
  const action = supplier ? updateSupplier.bind(null, supplier.id) : createSupplier;
  const [state, formAction, pending] = useActionState<SupplierFormResult, FormData>(
    action,
    initialSupplierFormResult
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      if (!supplier) formRef.current?.reset();
      onSaved?.();
    }
    wasPending.current = pending;
  }, [pending, state.ok, supplier, onSaved]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`name-${supplier?.id ?? "new"}`}>
          Name
        </label>
        <input
          id={`name-${supplier?.id ?? "new"}`}
          type="text"
          name="name"
          required
          defaultValue={supplier?.name}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`country-${supplier?.id ?? "new"}`}>
          Country / origin
        </label>
        <input
          id={`country-${supplier?.id ?? "new"}`}
          type="text"
          name="country"
          placeholder="UK, USA, Canada…"
          defaultValue={supplier?.country ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`origin-${supplier?.id ?? "new"}`}>
          Origin region
        </label>
        <input
          id={`origin-${supplier?.id ?? "new"}`}
          type="text"
          name="origin_region"
          placeholder="UK–Consort, USA–Miami…"
          defaultValue={supplier?.origin_region ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`currency-${supplier?.id ?? "new"}`}>
          Default currency
        </label>
        <select
          id={`currency-${supplier?.id ?? "new"}`}
          name="default_currency"
          defaultValue={supplier?.default_currency ?? "USD"}
          className={`${inputClass} mt-1`}
        >
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor={`lead-${supplier?.id ?? "new"}`}>
          Default lead time
        </label>
        <input
          id={`lead-${supplier?.id ?? "new"}`}
          type="text"
          name="default_lead_time_text"
          placeholder="4–8 weeks"
          defaultValue={supplier?.default_lead_time_text ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`notes-${supplier?.id ?? "new"}`}>
          Notes
        </label>
        <textarea
          id={`notes-${supplier?.id ?? "new"}`}
          name="notes"
          rows={2}
          defaultValue={supplier?.notes ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
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

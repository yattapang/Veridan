"use client";

import { useActionState } from "react";
import type { SupplierRow } from "@/lib/supabase/types";
import { setUploadSupplier, type ReviewActionResult } from "./actions";

const initialResult: ReviewActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

/**
 * Task 39 "Unmatched-supplier resolution" — server-enforced: no row can be
 * accepted until this upload's supplier is set (accepted rows need a
 * supplier for origin grouping later). Shown at the top of the review
 * screen in place of the row table whenever supplier_id is null.
 */
export function SupplierGateForm({ uploadId, suppliers }: { uploadId: string; suppliers: SupplierRow[] }) {
  const [state, formAction, pending] = useActionState(setUploadSupplier.bind(null, uploadId), initialResult);

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-5 py-4">
      <p className="text-sm font-medium text-veridan-ink">Set a supplier before reviewing rows</p>
      <p className="mt-1 text-sm text-veridan-warm-gray">
        This upload&apos;s supplier wasn&apos;t detected or confirmed. Choose one below — accepted rows need a
        supplier for shipment-origin grouping later.
      </p>
      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
        <select name="supplier_id" required defaultValue="" className={`${inputClass} max-w-xs`}>
          <option value="" disabled>
            Choose a supplier…
          </option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Set supplier"}
        </button>
        {state.ok === false && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </form>
    </div>
  );
}

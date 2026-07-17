"use client";

import { useActionState, useEffect, useRef } from "react";
import type { SupplierRow } from "@/lib/supabase/types";
import { ALLOWED_PRICE_FILE_EXTENSIONS } from "@/lib/price-files";
import { createPriceFileUpload, type PriceFileUploadFormResult } from "./actions";

const initialUploadFormResult: PriceFileUploadFormResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Upload form for a supplier price file (Task 36, Plan §2.2 Stage 1).
 * Supplier is optional — "Let extraction detect the supplier" is the
 * default option, matching the schema's nullable `supplier_id`. File type/
 * size are validated server-side (lib/price-files.ts, same pattern as
 * lib/enquiries/submit.ts); the `accept` attribute here is a UX hint only.
 */
export function UploadForm({ suppliers }: { suppliers: SupplierRow[] }) {
  const [state, formAction, pending] = useActionState<PriceFileUploadFormResult, FormData>(
    createPriceFileUpload,
    initialUploadFormResult
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      formRef.current?.reset();
    }
    wasPending.current = pending;
  }, [pending, state.ok]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="file">
          File
        </label>
        <input
          id="file"
          type="file"
          name="file"
          required
          accept={ALLOWED_PRICE_FILE_EXTENSIONS.join(",")}
          className={`${inputClass} mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-veridan-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:uppercase file:tracking-wide file:text-veridan-paper`}
        />
        <p className="mt-1 text-xs text-veridan-warm-gray">
          PDF, Excel (.xls/.xlsx), CSV, or an image (.png/.jpg/.jpeg/.webp). Max 15MB.
        </p>
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="supplier_id">
          Supplier
        </label>
        <select id="supplier_id" name="supplier_id" defaultValue="" className={`${inputClass} mt-1`}>
          <option value="">Let extraction detect the supplier</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Uploading…" : "Upload"}
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

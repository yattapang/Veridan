"use client";

import { useActionState } from "react";
import { recordPayment, type InvoiceActionResult } from "./actions";

const initialResult: InvoiceActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

export function RecordPaymentForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState(recordPayment.bind(null, invoiceId), initialResult);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass} htmlFor="amount_jmd">
          Amount (JMD)
        </label>
        <input
          id="amount_jmd"
          name="amount_jmd"
          type="number"
          step="0.01"
          min="0.01"
          required
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="paid_at">
          Date paid
        </label>
        <input id="paid_at" name="paid_at" type="date" defaultValue={today} className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="method">
          Method
        </label>
        <input
          id="method"
          name="method"
          type="text"
          placeholder="Bank transfer, cheque, cash…"
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="reference">
          Reference
        </label>
        <input id="reference" name="reference" type="text" placeholder="Cheque #, transfer ref…" className={`${inputClass} mt-1`} />
      </div>
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <input id="notes" name="notes" type="text" className={`${inputClass} mt-1`} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Recording…" : "Record payment"}
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

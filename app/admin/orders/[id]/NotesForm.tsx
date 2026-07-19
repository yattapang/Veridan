"use client";

import { useActionState } from "react";
import { updateOrderNotes, type OrderActionResult } from "./actions";

const initialResult: OrderActionResult = { ok: true };

export function NotesForm({ orderId, notes }: { orderId: string; notes: string | null }) {
  const [state, formAction, pending] = useActionState(updateOrderNotes.bind(null, orderId), initialResult);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <textarea
        name="notes"
        defaultValue={notes ?? ""}
        rows={3}
        className="w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none"
        placeholder="Founder notes about this order's fulfillment…"
      />
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save notes"}
        </button>
        {state.ok === false && (
          <span role="alert" className="ml-3 text-xs text-red-600">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}

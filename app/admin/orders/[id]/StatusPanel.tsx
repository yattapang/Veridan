"use client";

import { useState, useTransition } from "react";
import type { OrderStatus } from "@/lib/supabase/types";
import { ORDER_STATUS_LABELS } from "@/lib/orders/format";
import { reachableOrderStatuses } from "@/lib/orders/workflow";
import { transitionOrder } from "./actions";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const primaryButtonClass =
  "shrink-0 rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

/**
 * Task 53 status transitions: forward-only through the sequence, with
 * skipping allowed (e.g. confirmed -> delivered directly) except 'closed',
 * which requires 'delivered' first — see lib/orders/workflow.ts's
 * canTransitionOrder for the exact rule this dropdown's options come from.
 */
export function StatusPanel({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const options = reachableOrderStatuses(status);
  const [target, setTarget] = useState<OrderStatus | "">(options[0] ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Keep `target` in sync with the currently-valid options. This client
  // component instance PERSISTS across the server re-render that follows a
  // successful transition (revalidatePath), so without this reset `target`
  // would hold a now-invalid status (e.g. it stayed "delivered" after the
  // order actually became "delivered", making the dropdown display "Closed"
  // while submitting "delivered" → "cannot move from delivered back to
  // delivered"). Adjusting state during render is React's documented pattern
  // for resetting state when a prop changes; it converges in one extra render
  // because options[0] is always a member of `options`.
  if (target !== "" && !options.includes(target as OrderStatus)) {
    setTarget(options[0] ?? "");
  } else if (target === "" && options.length > 0) {
    setTarget(options[0]);
  }

  if (options.length === 0) {
    return <p className="text-sm text-veridan-warm-gray">This order is closed — no further status changes.</p>;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    if (!window.confirm(`Move this order to "${ORDER_STATUS_LABELS[target]}"?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await transitionOrder(orderId, target);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="status-target">
          Move to
        </label>
        <select
          id="status-target"
          value={target}
          onChange={(e) => setTarget(e.target.value as OrderStatus)}
          className={`${inputClass} mt-1`}
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending || !target} className={primaryButtonClass}>
        {pending ? "Updating…" : "Update status"}
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

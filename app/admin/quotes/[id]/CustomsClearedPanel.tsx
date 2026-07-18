"use client";

import { useState, useTransition } from "react";
import { markCustomsCleared, type WorkflowActionResult } from "./workflowActions";

const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

/**
 * Task 47 UI: the manual "Mark customs cleared" event that generates the
 * balance invoice. Shown only when the quote is accepted, has a deposit
 * invoice, and hasn't already been cleared — everything else is a read-only
 * state display (timestamp once cleared).
 */
export function CustomsClearedPanel({
  quoteId,
  canMarkCleared,
  customsClearedAt,
  hasDepositInvoice,
}: {
  quoteId: string;
  canMarkCleared: boolean;
  customsClearedAt: string | null;
  hasDepositInvoice: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm("Mark this quote's goods as customs cleared? This generates the balance invoice.")) return;
    setError(null);
    startTransition(async () => {
      const result: WorkflowActionResult = await markCustomsCleared(quoteId);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  }

  if (customsClearedAt) {
    return (
      <p className="text-sm text-veridan-warm-gray">
        Customs cleared {new Date(customsClearedAt).toLocaleString()}.
      </p>
    );
  }

  if (!hasDepositInvoice) {
    return (
      <p className="text-sm text-veridan-warm-gray">
        Waiting on the deposit invoice before customs can be marked cleared.
      </p>
    );
  }

  if (!canMarkCleared) return null;

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving…" : "Mark customs cleared"}
      </button>
      <p className="mt-2 text-xs text-veridan-warm-gray">
        Generates the balance invoice for the remaining amount due.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

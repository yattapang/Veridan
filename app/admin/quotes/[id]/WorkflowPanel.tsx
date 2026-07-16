"use client";

import { useActionState, useState, useTransition } from "react";
import type { QuoteStatus } from "@/lib/supabase/types";
import {
  acceptQuote,
  approveQuote,
  createRevision,
  declineQuote,
  initialWorkflowActionResult,
  markQuoteExpired,
  sendQuote,
} from "./workflowActions";

const buttonClass =
  "rounded-md border border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-50";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";
const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/** A single no-form-data action (approve / accept / decline / mark expired), wired to useTransition. */
function SimpleActionButton({
  label,
  pendingLabel,
  onRun,
  primary,
  confirmMessage,
}: {
  label: string;
  pendingLabel: string;
  onRun: () => Promise<{ ok: boolean; error?: string }>;
  primary?: boolean;
  confirmMessage?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setError(null);
    startTransition(async () => {
      const result = await onRun();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={primary ? primaryButtonClass : buttonClass}
      >
        {pending ? pendingLabel : label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function WorkflowPanel({
  quoteId,
  status,
  defaultRecipientEmail,
}: {
  quoteId: string;
  status: QuoteStatus;
  defaultRecipientEmail: string | null;
}) {
  const [sendState, sendAction, sendPending] = useActionState(
    sendQuote.bind(null, quoteId),
    initialWorkflowActionResult,
  );
  const [revisionState, revisionAction, revisionPending] = useActionState(
    createRevision.bind(null, quoteId),
    initialWorkflowActionResult,
  );

  const canRevise = status !== "draft";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {status === "draft" && (
          <SimpleActionButton
            label="Approve"
            pendingLabel="Approving…"
            primary
            onRun={() => approveQuote(quoteId)}
          />
        )}

        {(status === "sent" || status === "viewed") && (
          <>
            <SimpleActionButton
              label="Mark accepted"
              pendingLabel="Saving…"
              primary
              confirmMessage="Mark this quote as accepted by the client?"
              onRun={() => acceptQuote(quoteId)}
            />
            <SimpleActionButton
              label="Mark declined"
              pendingLabel="Saving…"
              confirmMessage="Mark this quote as declined by the client?"
              onRun={() => declineQuote(quoteId)}
            />
            <SimpleActionButton
              label="Mark expired"
              pendingLabel="Saving…"
              confirmMessage="Mark this quote as expired?"
              onRun={() => markQuoteExpired(quoteId)}
            />
          </>
        )}
      </div>

      {status === "approved" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="mb-3 text-xs text-amber-800">
            Quote emails send from <code>quotes@veridanlimited.com</code>. Replies go to the
            same address.
          </p>
          <form action={sendAction} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[260px] flex-1">
              <label className={labelClass} htmlFor="recipient_email">
                Send to
              </label>
              <input
                id="recipient_email"
                type="email"
                name="recipient_email"
                required
                defaultValue={defaultRecipientEmail ?? ""}
                placeholder="client@example.com"
                className={`${inputClass} mt-1`}
              />
            </div>
            <button type="submit" disabled={sendPending} className={primaryButtonClass}>
              {sendPending ? "Sending…" : "Send quote"}
            </button>
          </form>
          {sendState.ok === false && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {sendState.error}
            </p>
          )}
        </div>
      )}

      {canRevise && (
        <div className="border-t border-veridan-warm-gray-light pt-4">
          <form action={revisionAction} className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-veridan-warm-gray">
              <input type="checkbox" name="refresh_rates" className="h-3.5 w-3.5" />
              Refresh rates/parameters to current values (default: keep this quote&apos;s original
              snapshot)
            </label>
            <button type="submit" disabled={revisionPending} className={buttonClass}>
              {revisionPending ? "Creating revision…" : "Create revision"}
            </button>
          </form>
          {revisionState.ok === false && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {revisionState.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

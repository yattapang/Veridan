"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import type { InvoiceStatus } from "@/lib/supabase/types";
import { issueInvoice, regenerateInvoice, sendInvoice, voidInvoice, type InvoiceActionResult } from "./actions";

const initialResult: InvoiceActionResult = { ok: true };

const buttonClass =
  "rounded-md border border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-50";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";
const dangerButtonClass =
  "rounded-md border border-red-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-red-700 transition-opacity duration-150 hover:opacity-80 disabled:opacity-50";
const linkButtonClass =
  "rounded-md border border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-ink transition-opacity duration-150 hover:opacity-80 inline-block";
const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

function ActionButton({
  label,
  pendingLabel,
  onRun,
  variant = "default",
  confirmMessage,
}: {
  label: string;
  pendingLabel: string;
  onRun: () => Promise<InvoiceActionResult>;
  variant?: "default" | "primary" | "danger";
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

  const cls = variant === "primary" ? primaryButtonClass : variant === "danger" ? dangerButtonClass : buttonClass;

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={pending} className={cls}>
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

/**
 * Regenerate button (MINOR-5 fix) — separate from ActionButton because a
 * successful regenerate has somewhere new to send the founder: the newly
 * created invoice. Renders a link to it in place of the button rather than
 * redirecting, so the founder stays on the void invoice's page and can
 * choose when to follow the link.
 */
function RegenerateButton({ invoiceId }: { invoiceId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newInvoiceId, setNewInvoiceId] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await regenerateInvoice(invoiceId);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setNewInvoiceId(result.newInvoiceId);
    });
  }

  if (newInvoiceId) {
    return (
      <Link href={`/admin/invoices/${newInvoiceId}`} className={primaryButtonClass}>
        View regenerated invoice →
      </Link>
    );
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={pending} className={primaryButtonClass}>
        {pending ? "Regenerating…" : "Regenerate invoice"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function InvoiceActionsPanel({
  invoiceId,
  status,
  defaultRecipientEmail,
  sentPdfUrl,
  paymentInstructionsConfigured,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  defaultRecipientEmail: string | null;
  sentPdfUrl: string | null;
  paymentInstructionsConfigured: boolean;
}) {
  const canIssue = status === "draft";
  const canVoid = status === "draft" || status === "issued" || status === "sent";
  const canSend = status === "issued";
  // MINOR-5 fix: a void invoice is otherwise a dead end — offer a way to
  // create a fresh one for the same quote + type (regenerateInvoice guards
  // the quote's own state server-side; this button is just visibility).
  const canRegenerate = status === "void";

  const [sendState, sendAction, sendPending] = useActionState(sendInvoice.bind(null, invoiceId), initialResult);

  return (
    <div className="space-y-4">
      {/* MAJOR-3 fix: placeholder bank details gate. Shown for any invoice
          not yet sent so a founder sees it before reaching for "Send" —
          sendInvoice (app/admin/invoices/[id]/actions.ts) refuses server-side
          regardless of whether this banner was seen. */}
      {!paymentInstructionsConfigured && (status === "draft" || status === "issued") && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-xs font-medium text-amber-800">Payment instructions are not configured</p>
          <p className="mt-1 text-xs text-amber-800">
            This invoice&rsquo;s PDF still shows placeholder bank details. Add real bank details in{" "}
            <code>lib/site-content.ts</code> (<code>invoicePaymentInstructions</code>) before sending it to a
            client — sending is blocked until then.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canIssue && (
          <ActionButton label="Issue" pendingLabel="Issuing…" variant="primary" onRun={() => issueInvoice(invoiceId)} />
        )}

        <a href={`/api/invoices/${invoiceId}/pdf`} className={linkButtonClass}>
          Download PDF
        </a>

        {sentPdfUrl && (
          <a href={sentPdfUrl} className={linkButtonClass}>
            Download sent artifact
          </a>
        )}

        {canVoid && (
          <ActionButton
            label="Void"
            pendingLabel="Voiding…"
            variant="danger"
            confirmMessage="Void this invoice? This cannot be undone, and a voided invoice cannot be edited or paid against."
            onRun={() => voidInvoice(invoiceId)}
          />
        )}

        {canRegenerate && <RegenerateButton invoiceId={invoiceId} />}
      </div>

      {canSend && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="mb-3 text-xs text-amber-800">
            Invoice emails send from <code>quotes@veridanlimited.com</code>. Replies go to the same address.
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
              {sendPending ? "Sending…" : "Send invoice"}
            </button>
          </form>
          {sendState.ok === false && (
            <p role="alert" className="mt-2 text-xs text-red-600">
              {sendState.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

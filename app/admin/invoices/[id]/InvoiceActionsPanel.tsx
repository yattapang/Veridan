"use client";

import { useState, useTransition } from "react";
import type { InvoiceStatus } from "@/lib/supabase/types";
import { issueInvoice, voidInvoice, type InvoiceActionResult } from "./actions";

const buttonClass =
  "rounded-md border border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-50";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";
const dangerButtonClass =
  "rounded-md border border-red-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-red-700 transition-opacity duration-150 hover:opacity-80 disabled:opacity-50";
const disabledPlaceholderClass =
  "rounded-md border border-dashed border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-warm-gray opacity-60";

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

export function InvoiceActionsPanel({ invoiceId, status }: { invoiceId: string; status: InvoiceStatus }) {
  const canIssue = status === "draft";
  const canVoid = status === "draft" || status === "issued" || status === "sent";

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canIssue && (
        <ActionButton
          label="Issue"
          pendingLabel="Issuing…"
          variant="primary"
          onRun={() => issueInvoice(invoiceId)}
        />
      )}

      {/* Honest placeholders — PDF rendering and Resend delivery are Task 48, not built here. */}
      <span title="PDF rendering ships in Task 48" className={disabledPlaceholderClass}>
        Download PDF (coming soon)
      </span>
      <span title="Resend delivery ships in Task 48" className={disabledPlaceholderClass}>
        Send by email (coming soon)
      </span>

      {canVoid && (
        <ActionButton
          label="Void"
          pendingLabel="Voiding…"
          variant="danger"
          confirmMessage="Void this invoice? This cannot be undone, and a voided invoice cannot be edited or paid against."
          onRun={() => voidInvoice(invoiceId)}
        />
      )}
    </div>
  );
}

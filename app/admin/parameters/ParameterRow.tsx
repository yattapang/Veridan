"use client";

import { useActionState, useState } from "react";
import type { BusinessParameterRow } from "@/lib/supabase/types";
import {
  readPaymentInstructionsTableValue,
  type PaymentInstructionsTableValue,
} from "@/lib/invoices/paymentInstructionsCore";
import { updateParameter, type UpdateParameterResult } from "./actions";

const initialState: UpdateParameterResult = { ok: true };

/**
 * The one "table" parameter that gets a friendly per-field form instead of
 * the raw JSON textarea (founder-facing send-gate for invoices — a bad
 * comma in hand-edited JSON must never be the thing standing between a
 * founder and sending an invoice). Every other "table" parameter
 * (lead_times, company_details, margin_tiers, fx rates, ...) is untouched.
 *
 * The envelope/field shape is defined in lib/invoices/paymentInstructionsCore.ts
 * (PaymentInstructionsTableValue) and is load-bearing: it must exactly match
 * what lib/invoices/paymentInstructions.ts reads and what
 * paymentInstructionFieldsConfigured gates on (bank_name, account_number,
 * branch, routing_or_swift).
 */
const PAYMENT_INSTRUCTIONS_KEY = "invoice_payment_instructions";

const PAYMENT_INSTRUCTIONS_FIELD_LABELS: { key: keyof PaymentInstructionsTableValue; label: string; gated: boolean }[] = [
  { key: "bank_name", label: "Bank name", gated: true },
  { key: "account_name", label: "Account name", gated: false },
  { key: "account_number", label: "Account number", gated: true },
  { key: "branch", label: "Branch", gated: true },
  { key: "routing_or_swift", label: "Routing / SWIFT", gated: true },
  { key: "note", label: "Payment reference note", gated: false },
];

function PaymentInstructionsFields({ param }: { param: BusinessParameterRow }) {
  const [fields, setFields] = useState<PaymentInstructionsTableValue>(() =>
    readPaymentInstructionsTableValue(param.value?.value)
  );
  const inputClass =
    "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-1.5 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

  return (
    <div className="space-y-2">
      {PAYMENT_INSTRUCTIONS_FIELD_LABELS.map(({ key, label, gated }) => (
        <label key={key} className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
            {label}
            {gated && <span className="ml-1 normal-case text-veridan-warm-gray/70">(required to send)</span>}
          </span>
          <input
            type="text"
            value={fields[key]}
            onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
            className={`${inputClass} mt-1`}
          />
        </label>
      ))}
      {/* The server action (updateParameter) still takes the "value" field
          as a JSON string — same as the raw textarea it replaces — so we
          serialize here rather than change updateParameter's signature. */}
      <input type="hidden" name="value" value={JSON.stringify(fields)} />
      <p className="text-xs text-veridan-warm-gray">
        Sending an invoice unlocks once bank name, account number, branch, and
        routing/SWIFT no longer say “TODO”.
      </p>
    </div>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-JM", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function ValueInput({ param }: { param: BusinessParameterRow }) {
  const raw = param.value?.value;
  const baseInputClass =
    "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

  switch (param.value_type) {
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm text-veridan-ink">
          <input
            type="checkbox"
            name="value"
            defaultChecked={Boolean(raw)}
            className="h-4 w-4 rounded border-veridan-warm-gray-light accent-[var(--color-accent)]"
          />
          {Boolean(raw) ? "Enabled" : "Disabled"}
        </label>
      );
    case "numeric":
    case "percent":
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="any"
            name="value"
            defaultValue={typeof raw === "number" ? raw : String(raw ?? "")}
            className={baseInputClass}
          />
          {param.value_type === "percent" && (
            <span className="text-sm text-veridan-warm-gray">%</span>
          )}
        </div>
      );
    case "text":
      return (
        <input
          type="text"
          name="value"
          defaultValue={typeof raw === "string" ? raw : String(raw ?? "")}
          className={baseInputClass}
        />
      );
    case "table":
      if (param.key === PAYMENT_INSTRUCTIONS_KEY) {
        return <PaymentInstructionsFields param={param} />;
      }
      return (
        <textarea
          name="value"
          rows={4}
          defaultValue={JSON.stringify(raw, null, 2)}
          spellCheck={false}
          className={`${baseInputClass} font-mono text-xs`}
        />
      );
    default:
      return null;
  }
}

export function ParameterRow({ param }: { param: BusinessParameterRow }) {
  const boundAction = async (
    prevState: UpdateParameterResult,
    formData: FormData
  ) => updateParameter(param.key, prevState, formData);

  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
      <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
        <div>
          <p className="font-mono text-xs text-veridan-warm-gray">{param.key}</p>
          {param.description && (
            <p className="mt-1 text-sm text-veridan-ink/80">{param.description}</p>
          )}
          <p className="mt-1 text-xs text-veridan-warm-gray">
            Last updated {formatDate(param.updated_at)}
          </p>
        </div>

        <div className="space-y-2">
          <ValueInput param={param} />
          <input
            type="text"
            name="reason"
            placeholder="Reason for change (optional)"
            className="w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-1.5 text-xs text-veridan-ink focus:border-veridan-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-col items-start gap-1 sm:items-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {state.ok === false && (
            <p role="alert" className="max-w-[16rem] text-right text-xs text-red-600">
              {state.error}
            </p>
          )}
        </div>
      </form>
    </li>
  );
}

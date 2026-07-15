"use client";

import { useActionState, useId, useState } from "react";
import { HoneypotField } from "@/components/portal/HoneypotField";
import {
  fieldLabelClass,
  fieldInputClass,
  fieldHintClass,
  fieldErrorClass,
} from "@/components/portal/formClasses";
import { submitNewConstructionEnquiry, type SubmitState } from "./actions";

const initialState: SubmitState = { ok: true };

interface LineItemRow {
  key: string;
  description: string;
  qty: string;
  notes: string;
}

function newRow(): LineItemRow {
  return { key: crypto.randomUUID(), description: "", qty: "", notes: "" };
}

export function NewConstructionForm() {
  const [state, formAction, pending] = useActionState(
    submitNewConstructionEnquiry,
    initialState
  );
  const [scheduleMode, setScheduleMode] = useState<"file" | "structured">("file");
  const [rows, setRows] = useState<LineItemRow[]>([newRow()]);
  const formId = useId();

  function updateRow(key: string, field: keyof Omit<LineItemRow, "key">, value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  return (
    <form action={formAction} className="space-y-10" encType="multipart/form-data">
      <HoneypotField />

      <fieldset className="space-y-5">
        <legend className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">
          Company &amp; Contact
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={fieldLabelClass} htmlFor={`${formId}-company_name`}>
              Company name
            </label>
            <input
              id={`${formId}-company_name`}
              name="company_name"
              type="text"
              required
              className={fieldInputClass}
            />
          </div>
          <div>
            <label className={fieldLabelClass} htmlFor={`${formId}-contact_name`}>
              Contact name
            </label>
            <input
              id={`${formId}-contact_name`}
              name="contact_name"
              type="text"
              required
              className={fieldInputClass}
            />
          </div>
          <div>
            <label className={fieldLabelClass} htmlFor={`${formId}-contact_email`}>
              Email
            </label>
            <input
              id={`${formId}-contact_email`}
              name="contact_email"
              type="email"
              required
              className={fieldInputClass}
            />
          </div>
          <div>
            <label className={fieldLabelClass} htmlFor={`${formId}-contact_phone`}>
              Phone (optional)
            </label>
            <input
              id={`${formId}-contact_phone`}
              name="contact_phone"
              type="tel"
              className={fieldInputClass}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">
          Project Details
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={fieldLabelClass} htmlFor={`${formId}-project_name`}>
              Project name
            </label>
            <input
              id={`${formId}-project_name`}
              name="project_name"
              type="text"
              required
              className={fieldInputClass}
            />
          </div>
          <div>
            <label className={fieldLabelClass} htmlFor={`${formId}-site_location`}>
              Site location
            </label>
            <input
              id={`${formId}-site_location`}
              name="site_location"
              type="text"
              className={fieldInputClass}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={fieldLabelClass} htmlFor={`${formId}-delivery_timeframe`}>
              Delivery timeframe
            </label>
            <input
              id={`${formId}-delivery_timeframe`}
              name="delivery_timeframe"
              type="text"
              placeholder="e.g. Need on site by October 2026"
              className={fieldInputClass}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">
          Hardware Schedule
        </legend>
        <p className={fieldHintClass}>
          Upload the architect&rsquo;s hardware schedule, or enter line items
          directly if you don&rsquo;t have a file ready.
        </p>

        <input type="hidden" name="schedule_mode" value={scheduleMode} />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setScheduleMode("file")}
            className={`px-4 py-2 text-xs font-medium uppercase tracking-wide transition-colors ${
              scheduleMode === "file"
                ? "bg-veridan-ink text-veridan-paper"
                : "border border-veridan-warm-gray-light text-veridan-warm-gray"
            }`}
          >
            Upload File
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode("structured")}
            className={`px-4 py-2 text-xs font-medium uppercase tracking-wide transition-colors ${
              scheduleMode === "structured"
                ? "bg-veridan-ink text-veridan-paper"
                : "border border-veridan-warm-gray-light text-veridan-warm-gray"
            }`}
          >
            Enter Line Items
          </button>
        </div>

        {scheduleMode === "file" ? (
          <div>
            <label className={fieldLabelClass} htmlFor={`${formId}-hardware_schedule`}>
              Hardware schedule file
            </label>
            <input
              id={`${formId}-hardware_schedule`}
              name="hardware_schedule"
              type="file"
              accept=".pdf,.xls,.xlsx,.csv,image/*"
              className={`${fieldInputClass} file:mr-4 file:border-0 file:bg-veridan-warm-gray-pale file:px-3 file:py-1.5 file:text-xs file:font-medium file:uppercase file:tracking-wide`}
            />
            <p className={fieldHintClass}>PDF, Excel, CSV, or photo. Max 10MB.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="hidden gap-3 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray sm:grid sm:grid-cols-[2fr_1fr_2fr_auto]">
              <span>Description</span>
              <span>Qty</span>
              <span>Notes</span>
              <span />
            </div>
            {rows.map((row) => (
              <div
                key={row.key}
                className="grid gap-3 border-b border-veridan-warm-gray-light pb-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-start sm:border-b-0 sm:pb-0"
              >
                <input
                  type="text"
                  name="line_item_description"
                  placeholder="e.g. Mortise lockset, US32D"
                  value={row.description}
                  onChange={(e) => updateRow(row.key, "description", e.target.value)}
                  className={fieldInputClass}
                />
                <input
                  type="text"
                  name="line_item_qty"
                  placeholder="Qty"
                  value={row.qty}
                  onChange={(e) => updateRow(row.key, "qty", e.target.value)}
                  className={fieldInputClass}
                />
                <input
                  type="text"
                  name="line_item_notes"
                  placeholder="Optional notes"
                  value={row.notes}
                  onChange={(e) => updateRow(row.key, "notes", e.target.value)}
                  className={fieldInputClass}
                />
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                  disabled={rows.length === 1}
                  className="mt-1.5 self-start text-xs font-medium uppercase tracking-wide text-veridan-warm-gray hover:text-veridan-ink disabled:opacity-40 sm:mt-0"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, newRow()])}
              className="text-xs font-medium uppercase tracking-wide text-veridan-accent hover:text-veridan-ink"
            >
              + Add another line
            </button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <label className={fieldLabelClass} htmlFor={`${formId}-notes`}>
          Anything else we should know? (optional)
        </label>
        <textarea
          id={`${formId}-notes`}
          name="notes"
          rows={4}
          className={fieldInputClass}
        />
      </fieldset>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 bg-veridan-accent px-8 py-3 text-sm font-medium uppercase tracking-wide text-veridan-ink transition-colors duration-200 hover:bg-veridan-accent-soft disabled:opacity-50"
        >
          {pending ? "Submitting…" : "Submit Request"}
        </button>
        {state.ok === false && (
          <p role="alert" className={`${fieldErrorClass} mt-3`}>
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

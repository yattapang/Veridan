"use client";

import { useActionState, useId } from "react";
import { HoneypotField } from "@/components/portal/HoneypotField";
import {
  fieldLabelClass,
  fieldInputClass,
  fieldErrorClass,
} from "@/components/portal/formClasses";
import { submitRetrofitEnquiry, type SubmitState } from "./actions";

const initialState: SubmitState = { ok: true };

const BUILDING_TYPE_OPTIONS = [
  { value: "office", label: "Office" },
  { value: "hotel", label: "Hotel" },
  { value: "school", label: "School" },
  { value: "hospital", label: "Hospital" },
  { value: "retail", label: "Retail" },
  { value: "other", label: "Other" },
];

export function RetrofitForm() {
  const [state, formAction, pending] = useActionState(submitRetrofitEnquiry, initialState);
  const formId = useId();

  return (
    <form action={formAction} className="space-y-10">
      <HoneypotField />

      <fieldset className="space-y-5">
        <legend className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">
          Contact Information
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={fieldLabelClass} htmlFor={`${formId}-company_name`}>
              Company name (optional)
            </label>
            <input
              id={`${formId}-company_name`}
              name="company_name"
              type="text"
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
          The Problem
        </legend>
        <div>
          <label className={fieldLabelClass} htmlFor={`${formId}-building_type`}>
            Building type
          </label>
          <select
            id={`${formId}-building_type`}
            name="building_type"
            required
            defaultValue=""
            className={fieldInputClass}
          >
            <option value="" disabled>
              Select a building type
            </option>
            {BUILDING_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            className={fieldLabelClass}
            htmlFor={`${formId}-failing_hardware_description`}
          >
            What&rsquo;s failing?
          </label>
          <textarea
            id={`${formId}-failing_hardware_description`}
            name="failing_hardware_description"
            rows={4}
            required
            placeholder="e.g. Door closers on the 3rd floor stairwell doors won't hold the fire rating anymore, hinges are seized"
            className={fieldInputClass}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-veridan-ink">
          <input
            type="checkbox"
            name="urgency_flag"
            className="h-4 w-4 rounded border-veridan-warm-gray-light accent-[var(--color-accent)]"
          />
          This is urgent (safety, code compliance, or building-operations issue)
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">
          Which best describes you?
        </legend>
        <label className="flex items-start gap-2 text-sm text-veridan-ink">
          <input
            type="radio"
            name="retrofit_pathway"
            value="owner_direct"
            required
            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
          />
          <span>I&rsquo;m the building owner or facilities manager, sourcing directly.</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-veridan-ink">
          <input
            type="radio"
            name="retrofit_pathway"
            value="contractor_instructed"
            required
            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
          />
          <span>I&rsquo;m a contractor, sourcing on the owner&rsquo;s instruction.</span>
        </label>
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

"use client";

import { useActionState } from "react";
import type { SaveSectionResult } from "./actions";

const initialState: SaveSectionResult = { ok: true };

const inputClass =
  "mt-1 w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

export interface ScalarFieldConfig {
  name: string;
  label: string;
  kind: "text" | "textarea" | "paragraphs";
  help?: string;
}

/**
 * Plain labeled-field form for a scalar site_content section (site_meta,
 * contact_info, about_story) — Plan §1.6: "Scalar sections: plain labeled
 * text inputs/textareas per field — never a raw JSON textarea." Each field
 * posts under its own `name`; the bound server action reads them by name
 * and validates via lib/site-content-db/validation.ts.
 *
 * `kind: "paragraphs"` is for about_story.body (a string[] of paragraphs):
 * `initialValues` already joins them with a blank line, and the server
 * action splits back on blank lines.
 */
export function ScalarForm({
  fields,
  initialValues,
  action,
}: {
  fields: ScalarFieldConfig[];
  initialValues: Record<string, string>;
  action: (prevState: SaveSectionResult, formData: FormData) => Promise<SaveSectionResult>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.name} className={field.kind === "text" ? undefined : "sm:col-span-2"}>
            <label className={labelClass} htmlFor={`field-${field.name}`}>
              {field.label}
            </label>
            {field.kind === "text" ? (
              <input
                id={`field-${field.name}`}
                type="text"
                name={field.name}
                defaultValue={initialValues[field.name] ?? ""}
                className={inputClass}
              />
            ) : (
              <textarea
                id={`field-${field.name}`}
                name={field.name}
                rows={field.kind === "paragraphs" ? 6 : 3}
                defaultValue={initialValues[field.name] ?? ""}
                className={inputClass}
              />
            )}
            {field.help && <p className="mt-1 text-xs text-veridan-warm-gray">{field.help}</p>}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          name="reason"
          placeholder="Reason for change (optional)"
          className="w-64 rounded-md border border-veridan-warm-gray-light bg-white px-3 py-1.5 text-xs text-veridan-ink focus:border-veridan-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state.ok === false && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

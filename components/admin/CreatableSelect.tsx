"use client";

import { useRef } from "react";
import { CREATE_NEW_OPTION_VALUE, isCreateNewOptionValue } from "@/lib/admin/creatableSelect";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

export interface CreatableSelectOption {
  value: string;
  label: string;
}

/**
 * Shared "create a new X" dropdown affordance (founder feedback
 * 2026-08-07, see lib/admin/creatableSelect.ts's header for the verbatim
 * quote) — a normal <select> whose LAST option is "+ Create new …" rather
 * than a separate button/link/mode-toggle living beside the picker.
 *
 * Choosing that final option never leaves the select showing a
 * placeholder: `onRequestCreate` fires (the caller opens its inline
 * create panel, typically <InlineCreatePanel> below), and the select's
 * DOM value is snapped back to its previous `value` in the same tick —
 * done imperatively via `selectRef`, not by relying on a React re-render,
 * because `value` (the controlled prop) doesn't itself change when the
 * sentinel is chosen, so React alone would never re-sync the DOM node's
 * displayed selection.
 *
 * Every entity's option-list building (legacy/custom-value fallback,
 * locally-created-entry merging) stays the caller's responsibility — this
 * component only renders `options` plus the trailing create option and
 * owns the create-option interaction. See lib/admin/creatableSelect.ts
 * for the merge/sentinel helpers, and lib/taxonomies/taxonomyAdmin.ts /
 * lib/articles/categoryAdmin.ts for the legacy-value option builders used
 * by callers that need one.
 */
export function CreatableSelect({
  id,
  name,
  value,
  options,
  onChange,
  onRequestCreate,
  createOptionLabel,
  leadingOption,
  required,
  disabled,
  className = `${inputClass} mt-1`,
  ariaLabel,
}: {
  id?: string;
  name?: string;
  value: string;
  options: CreatableSelectOption[];
  onChange: (value: string) => void;
  onRequestCreate: () => void;
  /** e.g. "+ Create new company type" — always the entity's own noun. */
  createOptionLabel: string;
  /** An explicit first option, e.g. "— none —", "— ungrouped —", or a disabled "Choose a company…" prompt. */
  leadingOption?: { value: string; label: string; disabled?: boolean };
  required?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const selectRef = useRef<HTMLSelectElement>(null);

  return (
    <select
      ref={selectRef}
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        if (isCreateNewOptionValue(next)) {
          // Revert the DOM's displayed selection immediately, before the
          // browser paints — React won't do this on its own here because
          // the controlled `value` prop isn't changing, so nothing would
          // otherwise force the native element back off the sentinel.
          if (selectRef.current) selectRef.current.value = value;
          onRequestCreate();
          return;
        }
        onChange(next);
      }}
      className={className}
    >
      {leadingOption && (
        <option value={leadingOption.value} disabled={leadingOption.disabled}>
          {leadingOption.label}
        </option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
      <option value={CREATE_NEW_OPTION_VALUE} className="font-semibold text-veridan-accent-text">
        {createOptionLabel}
      </option>
    </select>
  );
}

/**
 * The inline create panel revealed beneath a CreatableSelect once its
 * trailing option is chosen. `children` carries whatever fields this
 * entity needs (a single label input; name + grade; name + type…) — kept
 * out of this component since the field set genuinely differs per entity,
 * per the build brief ("reveal an inline create field (name/label inputs
 * as each entity needs)").
 *
 * `onSubmit` is optional: most callers quick-create immediately via their
 * own server action and want a Save button here, but
 * app/admin/enquiries/[id]/ConvertForm.tsx defers the actual company
 * creation to the surrounding form's own submit (it reuses
 * convertEnquiryToProject, which also creates the primary contact and
 * project in one action) — that caller renders this panel with no
 * `onSubmit`, just its fields and Cancel.
 */
export function InlineCreatePanel({
  children,
  onCancel,
  onSubmit,
  pending,
  error,
  submitDisabled,
  submitLabel = "Create",
}: {
  children: React.ReactNode;
  onCancel: () => void;
  onSubmit?: () => void;
  pending?: boolean;
  error?: string | null;
  submitDisabled?: boolean;
  submitLabel?: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-start gap-3 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale p-3">
      {children}
      <div className="flex items-center gap-2">
        {onSubmit && (
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending || submitDisabled}
            className="rounded-md bg-veridan-ink px-3 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper disabled:opacity-50"
          >
            {pending ? "Creating…" : submitLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

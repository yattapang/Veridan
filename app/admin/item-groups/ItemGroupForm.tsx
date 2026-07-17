"use client";

import { useActionState, useEffect, useRef } from "react";
import { GRADE_VALUES, type ItemGroupRow } from "@/lib/supabase/types";
import { createItemGroup, updateItemGroup, type ItemGroupFormResult } from "./actions";

const initialItemGroupFormResult: ItemGroupFormResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Shared create/edit form for an item group (Task 30). `itemGroup` present
 * means edit/rename mode (bound to updateItemGroup); absent means the "new
 * group" form (bound to createItemGroup). Mirrors ProductForm.tsx /
 * SupplierForm.tsx's create-vs-edit convention.
 */
export function ItemGroupForm({
  itemGroup,
  onSaved,
}: {
  itemGroup?: ItemGroupRow;
  onSaved?: () => void;
}) {
  const action = itemGroup ? updateItemGroup.bind(null, itemGroup.id) : createItemGroup;
  const [state, formAction, pending] = useActionState<ItemGroupFormResult, FormData>(
    action,
    initialItemGroupFormResult
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const idSuffix = itemGroup?.id ?? "new";

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      if (!itemGroup) formRef.current?.reset();
      onSaved?.();
    }
    wasPending.current = pending;
  }, [pending, state.ok, itemGroup, onSaved]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`family-name-${idSuffix}`}>
          Family name
        </label>
        <input
          id={`family-name-${idSuffix}`}
          type="text"
          name="family_name"
          required
          placeholder="Commercial Lever Lockset"
          defaultValue={itemGroup?.family_name}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`grade-${idSuffix}`}>
          ANSI/BHMA grade
        </label>
        <select id={`grade-${idSuffix}`} name="grade" defaultValue={itemGroup?.grade ?? ""} className={`${inputClass} mt-1`}>
          <option value="">— not applicable —</option>
          {GRADE_VALUES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`notes-${idSuffix}`}>
          Notes
        </label>
        <textarea
          id={`notes-${idSuffix}`}
          name="notes"
          rows={2}
          defaultValue={itemGroup?.notes ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : itemGroup ? "Save changes" : "Add item group"}
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

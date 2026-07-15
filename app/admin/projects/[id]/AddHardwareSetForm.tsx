"use client";

import { useActionState, useEffect, useRef } from "react";
import { createHardwareSet, initialProjectActionResult } from "./actions";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

export function AddHardwareSetForm({ projectId, suggestedCode }: { projectId: string; suggestedCode: string }) {
  const [state, formAction, pending] = useActionState(
    createHardwareSet.bind(null, projectId),
    initialProjectActionResult
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      formRef.current?.reset();
    }
    wasPending.current = pending;
  }, [pending, state.ok]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-3">
      <div>
        <label className={labelClass} htmlFor="new-set-code">
          Code
        </label>
        <input
          id="new-set-code"
          type="text"
          name="code"
          placeholder={suggestedCode}
          defaultValue={suggestedCode}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="new-set-name">
          Name
        </label>
        <input
          id="new-set-name"
          type="text"
          name="name"
          placeholder="e.g. Office door, single leaf"
          className={`${inputClass} mt-1`}
        />
      </div>
      <div className="sm:col-span-3 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add hardware set"}
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

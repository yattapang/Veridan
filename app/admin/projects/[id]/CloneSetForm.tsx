"use client";

import { useActionState } from "react";
import { cloneHardwareSet } from "./actions";
import { initialProjectActionResult } from "./actionState";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

export interface CloneableSetOption {
  id: string;
  code: string;
  name: string | null;
  projectName: string;
}

export function CloneSetForm({ projectId, options }: { projectId: string; options: CloneableSetOption[] }) {
  const [state, formAction, pending] = useActionState(
    cloneHardwareSet.bind(null, projectId),
    initialProjectActionResult
  );

  if (options.length === 0) {
    return (
      <p className="text-xs text-veridan-warm-gray">
        No hardware sets exist yet on other projects to clone from.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-3">
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="clone-source">
          Set to clone
        </label>
        <select id="clone-source" name="source_set_id" required defaultValue="" className={`${inputClass} mt-1`}>
          <option value="" disabled>
            Choose a set…
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.projectName} — {o.code}
              {o.name ? ` (${o.name})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Cloning…" : "Clone into this project"}
        </button>
      </div>
      {state.ok === false && (
        <p role="alert" className="text-xs text-red-600 sm:col-span-3">
          {state.error}
        </p>
      )}
    </form>
  );
}

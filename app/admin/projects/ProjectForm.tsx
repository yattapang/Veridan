"use client";

import { useActionState, useEffect, useRef } from "react";
import { PROJECT_TYPES, type CompanyRow } from "@/lib/supabase/types";
import { createProject, type ProjectFormResult } from "./actions";

const initialProjectFormResult: ProjectFormResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

const TYPE_LABELS: Record<string, string> = {
  new_construction: "New construction",
  retrofit: "Retrofit",
};

export function ProjectForm({ companies }: { companies: CompanyRow[] }) {
  const [state, formAction, pending] = useActionState(createProject, initialProjectFormResult);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      formRef.current?.reset();
    }
    wasPending.current = pending;
  }, [pending, state.ok]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="project-name">
          Project name
        </label>
        <input id="project-name" type="text" name="name" required className={`${inputClass} mt-1`} />
      </div>

      <div>
        <label className={labelClass} htmlFor="project-company">
          Company
        </label>
        <select id="project-company" name="company_id" required defaultValue="" className={`${inputClass} mt-1`}>
          <option value="" disabled>
            Choose a company…
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="project-type">
          Type
        </label>
        <select id="project-type" name="project_type" defaultValue="new_construction" className={`${inputClass} mt-1`}>
          {PROJECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="project-site-address">
          Site address
        </label>
        <input id="project-site-address" type="text" name="site_address" className={`${inputClass} mt-1`} />
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending || companies.length === 0}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Add project"}
        </button>
        {companies.length === 0 && (
          <p className="text-xs text-veridan-warm-gray">Add a company first.</p>
        )}
        {state.ok === false && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

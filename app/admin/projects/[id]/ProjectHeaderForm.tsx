"use client";

import { useActionState } from "react";
import { PROJECT_STATUSES, PROJECT_TYPES, type CompanyRow, type ProjectRow } from "@/lib/supabase/types";
import { updateProject, initialProjectActionResult } from "./actions";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

const TYPE_LABELS: Record<string, string> = {
  new_construction: "New construction",
  retrofit: "Retrofit",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  closed: "Closed",
  archived: "Archived",
};

export function ProjectHeaderForm({ project, companies }: { project: ProjectRow; companies: CompanyRow[] }) {
  const [state, formAction, pending] = useActionState(
    updateProject.bind(null, project.id),
    initialProjectActionResult
  );

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="header-name">
          Project name
        </label>
        <input
          id="header-name"
          type="text"
          name="name"
          required
          defaultValue={project.name}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="header-type">
          Type
        </label>
        <select id="header-type" name="project_type" defaultValue={project.project_type} className={`${inputClass} mt-1`}>
          {PROJECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="header-status">
          Status
        </label>
        <select id="header-status" name="status" defaultValue={project.status} className={`${inputClass} mt-1`}>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="header-architect">
          Architect company
        </label>
        <select
          id="header-architect"
          name="architect_company_id"
          defaultValue={project.architect_company_id ?? ""}
          className={`${inputClass} mt-1`}
        >
          <option value="">— none —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="header-site-address">
          Site address
        </label>
        <input
          id="header-site-address"
          type="text"
          name="site_address"
          defaultValue={project.site_address ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
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

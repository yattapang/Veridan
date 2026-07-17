"use client";

import { useActionState, useState } from "react";
import type { ProjectWithCompany, CompanyRow } from "@/lib/supabase/types";
import { seedQuoteFromReview, type ReviewActionResult } from "./actions";

const initialResult: ReviewActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Task 41 "Seed a quote from this scan". Founder picks EITHER an existing
 * project OR a company to start a new retrofit project under — mirrors the
 * Task 17 company-page pattern (CompanyQuoteForm.tsx). Submits straight to
 * seedQuoteFromReview, which redirects into the new quote's builder on
 * success.
 */
export function SeedQuoteForm({
  uploadId,
  projects,
  companies,
  acceptedCount,
}: {
  uploadId: string;
  projects: ProjectWithCompany[];
  companies: CompanyRow[];
  acceptedCount: number;
}) {
  const [state, formAction, pending] = useActionState(seedQuoteFromReview.bind(null, uploadId), initialResult);
  const [mode, setMode] = useState<"existing" | "new">(projects.length > 0 ? "existing" : "new");

  if (acceptedCount === 0) {
    return (
      <p className="text-sm text-veridan-warm-gray">
        Accept at least one row to seed a draft quote from this scan.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-3">
      <p className="text-sm text-veridan-warm-gray">
        Creates a draft line-item quote from the {acceptedCount} accepted row{acceptedCount === 1 ? "" : "s"} on this
        upload, then opens it in the normal quote builder for margin, FX, and shipment entry.
      </p>

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="target_mode"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
            disabled={projects.length === 0}
          />
          Existing project
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="target_mode" checked={mode === "new"} onChange={() => setMode("new")} />
          New retrofit project under a company
        </label>
      </div>

      {mode === "existing" ? (
        <div>
          <label className={labelClass} htmlFor="project_id">
            Project
          </label>
          <select id="project_id" name="project_id" required defaultValue="" className={`${inputClass} mt-1`}>
            <option value="" disabled>
              Choose a project…
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.companies?.name ?? "Unknown company"}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="company_id">
              Company
            </label>
            <select id="company_id" name="company_id" required defaultValue="" className={`${inputClass} mt-1`}>
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
            <label className={labelClass} htmlFor="project_name">
              Project / job name
            </label>
            <input
              id="project_name"
              type="text"
              name="project_name"
              placeholder="Defaults to Retrofit — Company — today"
              className={`${inputClass} mt-1`}
            />
          </div>
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-accent px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating quote…" : "Seed a quote from this scan"}
        </button>
      </div>
      {state.ok === false && (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}

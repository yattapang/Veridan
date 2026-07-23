"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CATALOGUE_VISIBILITIES, type CatalogueVisibility } from "@/lib/supabase/types";
import { ALLOWED_CATALOGUE_FILE_EXTENSIONS, ALLOWED_CATALOGUE_THUMBNAIL_EXTENSIONS } from "@/lib/catalogue/validation";
import { CATALOGUE_RIGHTS_CONFIRMATION_WARNING, DEFAULT_CATALOGUE_VISIBILITY } from "@/lib/catalogue/visibility";
import { createCatalogueDocument, type CatalogueActionResult } from "./actions";

const initialResult: CatalogueActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

const VISIBILITY_LABELS: Record<CatalogueVisibility, string> = { internal: "Internal", public: "Public" };

/**
 * Upload form for a supplier catalogue/spec-sheet document (Plan §3.4).
 * Structure mirrors app/admin/price-files/UploadForm.tsx. Visibility
 * defaults to Internal HERE in the form's own defaultValue AND at the
 * schema level (the migration's column default) — two independent layers,
 * per the §3.3 guardrail. When a founder chooses Public directly at upload
 * time, this form requires an explicit rights-confirmation checkbox before
 * it will submit; see CATALOGUE_RIGHTS_CONFIRMATION_WARNING.
 */
export function UploadForm() {
  const [state, formAction, pending] = useActionState<CatalogueActionResult, FormData>(
    createCatalogueDocument,
    initialResult
  );
  const [visibility, setVisibility] = useState<CatalogueVisibility>(DEFAULT_CATALOGUE_VISIBILITY);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      formRef.current?.reset();
      setVisibility(DEFAULT_CATALOGUE_VISIBILITY);
      setRightsConfirmed(false);
    }
    wasPending.current = pending;
  }, [pending, state.ok]);

  const wantsPublic = visibility === "public";
  const blockedByRightsConfirmation = wantsPublic && !rightsConfirmed;

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="file">
          Document (PDF)
        </label>
        <input
          id="file"
          type="file"
          name="file"
          required
          accept={ALLOWED_CATALOGUE_FILE_EXTENSIONS.join(",")}
          className={`${inputClass} mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-veridan-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:uppercase file:tracking-wide file:text-veridan-paper`}
        />
        <p className="mt-1 text-xs text-veridan-warm-gray">PDF only. Max 25MB.</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="brand">
          Brand
        </label>
        <input
          id="brand"
          type="text"
          name="brand"
          required
          placeholder="Assa Abloy"
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="category">
          Category
        </label>
        <input
          id="category"
          type="text"
          name="category"
          placeholder="Locksets & Deadbolts"
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="title">
          Title
        </label>
        <input
          id="title"
          type="text"
          name="title"
          required
          placeholder="2026 Commercial Hardware Catalogue"
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="description">
          Description
        </label>
        <textarea id="description" name="description" rows={2} className={`${inputClass} mt-1`} />
      </div>

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="thumbnail">
          Thumbnail (optional)
        </label>
        <input
          id="thumbnail"
          type="file"
          name="thumbnail"
          accept={ALLOWED_CATALOGUE_THUMBNAIL_EXTENSIONS.join(",")}
          className={`${inputClass} mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-veridan-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:uppercase file:tracking-wide file:text-veridan-paper`}
        />
        <p className="mt-1 text-xs text-veridan-warm-gray">PNG, JPG, or WEBP. Max 5MB. Shown on the public browse card if the document is Public.</p>
      </div>

      <div className="sm:col-span-2 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale px-4 py-3">
        <label className={labelClass} htmlFor="visibility">
          Visibility
        </label>
        <select
          id="visibility"
          name="visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as CatalogueVisibility)}
          className={`${inputClass} mt-1 sm:max-w-xs`}
        >
          {CATALOGUE_VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {VISIBILITY_LABELS[v]}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs font-medium text-amber-700">{CATALOGUE_RIGHTS_CONFIRMATION_WARNING}</p>
        {wantsPublic && (
          <label className="mt-2 flex items-start gap-2 text-xs text-veridan-ink">
            <input
              type="checkbox"
              name="rights_confirmed"
              value="true"
              checked={rightsConfirmed}
              onChange={(e) => setRightsConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            I confirm Veridan is licensed to publish this supplier&apos;s catalogue publicly.
          </label>
        )}
        <p className="mt-2 text-xs text-veridan-warm-gray">Every upload defaults to Internal — this is safe to leave as-is until you&apos;re ready to publish.</p>
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending || blockedByRightsConfirmation}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Uploading…" : "Upload"}
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

"use client";

import { useActionState, useEffect, useRef } from "react";
import type { CatalogueDocumentRow } from "@/lib/supabase/types";
import { updateCatalogueDocument, type CatalogueActionResult } from "./actions";

const initialResult: CatalogueActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Edit-in-place form for a catalogue document's text fields (brand,
 * category, title, description). Deliberately does NOT touch visibility,
 * the file, or the thumbnail — those each have their own dedicated control
 * (CatalogueListItem's toggle button / thumbnail uploader) so an edit save
 * can never accidentally flip a document public.
 */
export function CatalogueDocumentForm({
  document,
  onSaved,
}: {
  document: CatalogueDocumentRow;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState<CatalogueActionResult, FormData>(
    updateCatalogueDocument.bind(null, document.id),
    initialResult
  );
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) onSaved?.();
    wasPending.current = pending;
  }, [pending, state.ok, onSaved]);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass} htmlFor={`brand-${document.id}`}>
          Brand
        </label>
        <input
          id={`brand-${document.id}`}
          type="text"
          name="brand"
          required
          defaultValue={document.brand}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor={`category-${document.id}`}>
          Category
        </label>
        <input
          id={`category-${document.id}`}
          type="text"
          name="category"
          defaultValue={document.category ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`title-${document.id}`}>
          Title
        </label>
        <input
          id={`title-${document.id}`}
          type="text"
          name="title"
          required
          defaultValue={document.title}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`description-${document.id}`}>
          Description
        </label>
        <textarea
          id={`description-${document.id}`}
          name="description"
          rows={2}
          defaultValue={document.description ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div className="sm:col-span-2 flex items-center gap-2">
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

"use client";

import { useActionState } from "react";
import { ALLOWED_CATALOGUE_THUMBNAIL_EXTENSIONS } from "@/lib/catalogue/validation";
import { replaceCatalogueThumbnail, type CatalogueActionResult } from "./actions";

const initialResult: CatalogueActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";

/** Mirrors app/admin/articles/[id]/edit/HeroImageUploader.tsx's shape. */
export function ThumbnailUploader({ documentId, currentThumbnailUrl }: { documentId: string; currentThumbnailUrl: string | null }) {
  const [state, formAction, pending] = useActionState<CatalogueActionResult, FormData>(
    replaceCatalogueThumbnail.bind(null, documentId),
    initialResult
  );

  return (
    <div>
      {currentThumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- admin-only preview of a signed, short-lived Storage URL; not a static remote-pattern candidate.
        <img
          src={currentThumbnailUrl}
          alt="Current thumbnail"
          className="mb-2 h-20 w-20 rounded-md border border-veridan-warm-gray-light object-cover"
        />
      )}
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="thumbnail"
          accept={ALLOWED_CATALOGUE_THUMBNAIL_EXTENSIONS.join(",")}
          required
          className={`${inputClass} max-w-xs text-xs file:mr-2 file:rounded-md file:border-0 file:bg-veridan-ink file:px-2 file:py-1 file:text-[10px] file:font-medium file:uppercase file:tracking-wide file:text-veridan-paper`}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-veridan-warm-gray-light px-3 py-1.5 text-xs font-medium text-veridan-ink hover:bg-veridan-warm-gray-pale disabled:opacity-50"
        >
          {pending ? "Uploading…" : currentThumbnailUrl ? "Replace" : "Upload"}
        </button>
      </form>
      {state.ok === false && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {state.error}
        </p>
      )}
    </div>
  );
}

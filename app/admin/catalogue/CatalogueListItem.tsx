"use client";

import { useState, useTransition } from "react";
import type { CatalogueDocumentWithDetails } from "@/lib/supabase/types";
import { catalogueVisibilityBadgeClass, catalogueVisibilityLabel, formatFileSize } from "@/lib/catalogue/validation";
import {
  CATALOGUE_RIGHTS_CONFIRMATION_WARNING,
  nextCatalogueVisibility,
  transitionNeedsRightsConfirmation,
} from "@/lib/catalogue/visibility";
import { deleteCatalogueDocument, setCatalogueVisibility } from "./actions";
import { CatalogueDocumentForm } from "./CatalogueDocumentForm";
import { ThumbnailUploader } from "./ThumbnailUploader";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * A row in the admin catalogue list (Plan §3.4): visibility badge, a
 * one-click toggle action, and — per §3.3 — the rights-confirmation warning
 * shown PERSISTENTLY next to the visibility control (not only inside a
 * confirm dialog), plus an explicit window.confirm() gate on the
 * internal -> public transition specifically (mirrors the existing
 * delete-confirm pattern in app/admin/item-groups/ItemGroupListItem.tsx).
 */
export function CatalogueListItem({
  document,
  downloadUrl,
  thumbnailUrl,
}: {
  document: CatalogueDocumentWithDetails;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggleVisibility() {
    setError(null);
    const next = nextCatalogueVisibility(document.visibility);
    if (transitionNeedsRightsConfirmation(document.visibility, next)) {
      const confirmed = window.confirm(
        `${CATALOGUE_RIGHTS_CONFIRMATION_WARNING}\n\nMake "${document.title}" public?`
      );
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(`Make "${document.title}" internal-only again?`);
      if (!confirmed) return;
    }
    startTransition(async () => {
      const result = await setCatalogueVisibility(document.id, next);
      if (!result.ok) setError(result.error);
    });
  }

  function handleDelete() {
    setError(null);
    const confirmed = window.confirm(`Delete "${document.title}"? This removes the file permanently.`);
    if (!confirmed) return;
    startTransition(async () => {
      const result = await deleteCatalogueDocument(document.id);
      if (!result.ok) setError(result.error);
    });
  }

  const toggleLabel = document.visibility === "public" ? "Make internal" : "Make public";

  return (
    <li className="flex flex-wrap items-start justify-between gap-4 border-b border-veridan-warm-gray-light py-4 last:border-b-0">
      <div className="flex min-w-0 gap-3">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-only preview of a signed, short-lived Storage URL.
          <img
            src={thumbnailUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded-md border border-veridan-warm-gray-light object-cover"
          />
        ) : (
          <div className="h-14 w-14 shrink-0 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale" />
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${catalogueVisibilityBadgeClass(document.visibility)}`}
            >
              {catalogueVisibilityLabel(document.visibility)}
            </span>
            <p className="text-sm font-medium text-veridan-ink">{document.title}</p>
          </div>
          <p className="mt-1 text-xs text-veridan-warm-gray">
            {document.brand}
            {document.category ? ` · ${document.category}` : ""}
            {formatFileSize(document.file_size_bytes) ? ` · ${formatFileSize(document.file_size_bytes)}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-veridan-warm-gray">
            Uploaded {formatDate(document.uploaded_at)}
            {document.users?.display_name || document.users?.email
              ? ` by ${document.users.display_name ?? document.users.email}`
              : ""}
          </p>
          {document.description && <p className="mt-1 text-xs text-veridan-warm-gray">{document.description}</p>}
          {/* Persistent, always-visible rights-confirmation reminder next to the visibility control (Plan §3.3 — "a clear warning next to the publish/visibility control"), not only inside the confirm() dialog above. */}
          <p className="mt-2 max-w-md text-[11px] italic text-amber-700">{CATALOGUE_RIGHTS_CONFIRMATION_WARNING}</p>
          {error && (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {error}
            </p>
          )}

          {editing && (
            <div className="mt-3 space-y-3 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale p-3">
              <CatalogueDocumentForm document={document} onSaved={() => setEditing(false)} />
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-veridan-warm-gray">
                  Thumbnail
                </p>
                <ThumbnailUploader documentId={document.id} currentThumbnailUrl={thumbnailUrl} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {downloadUrl && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            Preview
          </a>
        )}
        <button
          type="button"
          onClick={handleToggleVisibility}
          disabled={pending}
          className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft disabled:opacity-50"
        >
          {toggleLabel}
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
        >
          {editing ? "Close" : "Edit"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink disabled:opacity-50"
        >
          {pending ? "Working…" : "Delete"}
        </button>
      </div>
    </li>
  );
}

"use client";

import { useActionState, useState } from "react";
import type { SaveSectionResult } from "./actions";
import { InstallPhotoUpload } from "./InstallPhotoUpload";

const initialState: SaveSectionResult = { ok: true };

const inputClass =
  "mt-1 w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

export interface InstallGalleryItem {
  imagePath: string;
  caption: string;
  /** Resolved server-side (public bucket, no signing) — see app/admin/content/page.tsx. */
  imageUrl: string | null;
}

type ItemWithId = InstallGalleryItem & { readonly _id: string };

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `photo-${idCounter}-${Date.now()}`;
}

/**
 * Framework B's admin editor for `install_gallery` ("Completed Installs /
 * Our Work") — a bespoke structured list editor (not the generic
 * ListEditor.tsx) since each row's photo is a required upload, not a text
 * field. Same "upload immediately, Save persists paths + captions" split as
 * BrandsEditor.tsx.
 */
export function InstallGalleryEditor({
  initialItems,
  action,
}: {
  initialItems: InstallGalleryItem[];
  action: (prevState: SaveSectionResult, formData: FormData) => Promise<SaveSectionResult>;
}) {
  const [items, setItems] = useState<ItemWithId[]>(() =>
    initialItems.map((item) => ({ ...item, _id: makeId() }))
  );
  const [state, formAction, pending] = useActionState(action, initialState);

  function updateCaption(id: string, caption: string) {
    setItems((prev) => prev.map((item) => (item._id === id ? { ...item, caption } : item)));
  }

  function addPhoto(imagePath: string, imageUrl: string) {
    setItems((prev) => [...prev, { imagePath, imageUrl, caption: "", _id: makeId() }]);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item._id !== id));
  }

  function moveItem(id: string, direction: -1 | 1) {
    setItems((prev) => {
      const index = prev.findIndex((item) => item._id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const serialized = JSON.stringify(
    items.map((item) => ({ image_path: item.imagePath, caption: item.caption }))
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="items" value={serialized} />

      {items.length === 0 && (
        <p className="text-sm text-veridan-warm-gray">
          No photos yet — add one below. The &ldquo;Our Work&rdquo; section stays hidden on the
          live site until at least one photo is saved here.
        </p>
      )}

      <ul className="space-y-4">
        {items.map((item, index) => (
          <li
            key={item._id}
            className="flex flex-wrap items-start gap-4 rounded-md border border-veridan-warm-gray-light bg-white p-4"
          >
            {item.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- admin-only preview of a public Storage-hosted image; see app/(marketing)/page.tsx's "Our Work" section for the same choice on the public side.
              <img
                src={item.imageUrl}
                alt=""
                className="h-24 w-32 shrink-0 rounded border border-veridan-warm-gray-light object-cover"
              />
            )}
            <div className="min-w-[12rem] flex-1">
              <label className={labelClass}>Caption (optional)</label>
              <input
                type="text"
                value={item.caption}
                onChange={(e) => updateCaption(item._id, e.target.value)}
                placeholder="e.g. Commercial exit devices, downtown Kingston"
                className={inputClass}
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => moveItem(item._id, -1)}
                  disabled={index === 0}
                  className="text-xs text-veridan-warm-gray hover:text-veridan-ink disabled:opacity-30"
                >
                  ↑ Move up
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(item._id, 1)}
                  disabled={index === items.length - 1}
                  className="text-xs text-veridan-warm-gray hover:text-veridan-ink disabled:opacity-30"
                >
                  ↓ Move down
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(item._id)}
                  className="text-xs font-medium text-red-600 hover:text-red-700"
                >
                  Remove photo
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <InstallPhotoUpload onUploaded={addPhoto} />

      <div className="flex items-center gap-3 pt-2">
        <input
          type="text"
          name="reason"
          placeholder="Reason for change (optional)"
          className="w-64 rounded-md border border-veridan-warm-gray-light bg-white px-3 py-1.5 text-xs text-veridan-ink focus:border-veridan-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
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

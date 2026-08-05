"use client";

import { useActionState, useState } from "react";
import type { SaveSectionResult } from "./actions";
import { BrandLogoUpload } from "./BrandLogoUpload";

const initialState: SaveSectionResult = { ok: true };

const inputClass =
  "mt-1 w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

export interface BrandItem {
  name: string;
  logoPath: string | null;
  /** Resolved server-side (public bucket, no signing) — see app/admin/content/page.tsx. */
  logoUrl: string | null;
}

type ItemWithId = BrandItem & { readonly _id: string };

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `brand-${idCounter}-${Date.now()}`;
}

/**
 * Framework A's admin editor for `brands_supplied` — a bespoke structured
 * list editor (not the generic ListEditor.tsx) since each row also manages
 * an optional logo image upload. Mirrors ListEditor's "one hidden JSON
 * field, one Save button" shape: BrandLogoUpload uploads immediately and
 * reports back into this component's list state; the Save button here only
 * ever submits already-uploaded paths (never a File) as
 * `[{name, logo_path}]`, read by app/admin/content/actions.ts's
 * saveBrandsSupplied.
 */
export function BrandsEditor({
  initialItems,
  action,
}: {
  initialItems: BrandItem[];
  action: (prevState: SaveSectionResult, formData: FormData) => Promise<SaveSectionResult>;
}) {
  const [items, setItems] = useState<ItemWithId[]>(() =>
    initialItems.map((item) => ({ ...item, _id: makeId() }))
  );
  const [state, formAction, pending] = useActionState(action, initialState);

  function updateName(id: string, name: string) {
    setItems((prev) => prev.map((item) => (item._id === id ? { ...item, name } : item)));
  }

  function setLogo(id: string, logoPath: string | null, logoUrl: string | null) {
    setItems((prev) => prev.map((item) => (item._id === id ? { ...item, logoPath, logoUrl } : item)));
  }

  function addItem() {
    setItems((prev) => [...prev, { name: "", logoPath: null, logoUrl: null, _id: makeId() }]);
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
    items.map((item) => ({ name: item.name, logo_path: item.logoPath }))
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="items" value={serialized} />

      {items.length === 0 && (
        <p className="text-sm text-veridan-warm-gray">
          No brands yet — use &ldquo;Add brand&rdquo; below.
        </p>
      )}

      <ul className="space-y-4">
        {items.map((item, index) => (
          <li
            key={item._id}
            className="rounded-md border border-veridan-warm-gray-light bg-white p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Brand name</label>
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => updateName(item._id, e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Logo (optional)</label>
                <div className="mt-1">
                  <BrandLogoUpload
                    brandKey={item._id}
                    currentLogoUrl={item.logoUrl}
                    onUploaded={(path, url) => setLogo(item._id, path, url)}
                    onRemove={() => setLogo(item._id, null, null)}
                  />
                </div>
              </div>
            </div>
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
                className="ml-auto text-xs font-medium text-red-600 hover:text-red-700"
              >
                Remove brand
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={addItem}
        className="rounded-md border border-veridan-warm-gray-light px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-veridan-ink hover:bg-veridan-warm-gray-pale"
      >
        + Add brand
      </button>

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

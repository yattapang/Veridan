"use client";

import { useActionState, useState } from "react";
import type { SaveSectionResult } from "./actions";

const initialState: SaveSectionResult = { ok: true };

const inputClass =
  "mt-1 w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

export interface ListFieldConfig {
  name: string;
  label: string;
  kind: "text" | "textarea" | "stringlist";
  placeholder?: string;
}

type Item = Record<string, unknown>;
type ItemWithId = Item & { readonly _id: string };

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `row-${idCounter}-${Date.now()}`;
}

function stringlistToText(value: unknown): string {
  return Array.isArray(value) ? (value as unknown[]).map(String).join(", ") : "";
}

function textToStringlist(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Structured "add row / remove row" editor over a JSON-array-valued
 * site_content section (Plan §1.6: "a client component rendering one
 * mini-form per array item with Add row / Remove row controls ... the same
 * 'structured list editor over a JSON column' shape as admin/item-groups'
 * merge UI"). Serializes the current items array to a hidden `items` field
 * as JSON on every render, so the bound server action always receives the
 * latest client state on submit — the JSON itself is never user-facing
 * (users only ever see the labeled per-field inputs below).
 */
export function ListEditor({
  initialItems,
  fields,
  emptyItem,
  action,
  itemLabel,
}: {
  initialItems: Item[];
  fields: ListFieldConfig[];
  emptyItem: Item;
  action: (prevState: SaveSectionResult, formData: FormData) => Promise<SaveSectionResult>;
  itemLabel: string;
}) {
  const [items, setItems] = useState<ItemWithId[]>(() =>
    initialItems.map((item) => ({ ...item, _id: makeId() }))
  );
  const [state, formAction, pending] = useActionState(action, initialState);

  function updateField(id: string, name: string, value: unknown) {
    setItems((prev) => prev.map((item) => (item._id === id ? { ...item, [name]: value } : item)));
  }

  function addItem() {
    setItems((prev) => [...prev, { ...emptyItem, _id: makeId() }]);
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
    items.map((item) => {
      const rest: Item = {};
      for (const k of Object.keys(item)) {
        if (k !== "_id") rest[k] = item[k];
      }
      return rest;
    })
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="items" value={serialized} />

      {items.length === 0 && (
        <p className="text-sm text-veridan-warm-gray">
          No {itemLabel}s yet — use &ldquo;Add {itemLabel}&rdquo; below.
        </p>
      )}

      <ul className="space-y-4">
        {items.map((item, index) => (
          <li
            key={item._id}
            className="rounded-md border border-veridan-warm-gray-light bg-white p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((field) => (
                <div
                  key={field.name}
                  className={field.kind === "text" ? undefined : "sm:col-span-2"}
                >
                  <label className={labelClass}>{field.label}</label>
                  {field.kind === "textarea" ? (
                    <textarea
                      rows={3}
                      value={String(item[field.name] ?? "")}
                      onChange={(e) => updateField(item._id, field.name, e.target.value)}
                      placeholder={field.placeholder}
                      className={inputClass}
                    />
                  ) : field.kind === "stringlist" ? (
                    <input
                      type="text"
                      value={stringlistToText(item[field.name])}
                      onChange={(e) =>
                        updateField(item._id, field.name, textToStringlist(e.target.value))
                      }
                      placeholder={field.placeholder ?? "Comma-separated"}
                      className={inputClass}
                    />
                  ) : (
                    <input
                      type="text"
                      value={String(item[field.name] ?? "")}
                      onChange={(e) => updateField(item._id, field.name, e.target.value)}
                      placeholder={field.placeholder}
                      className={inputClass}
                    />
                  )}
                </div>
              ))}
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
                Remove {itemLabel}
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
        + Add {itemLabel}
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

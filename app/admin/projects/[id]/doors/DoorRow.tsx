"use client";

import { useActionState, useState, useTransition } from "react";
import type { DoorWithHardwareSet, HardwareSetRow } from "@/lib/supabase/types";
import { deleteDoor, duplicateDoor, updateDoor } from "./actions";
import { initialDoorActionResult } from "./actionState";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-2 py-1.5 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray";

function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function DoorRow({
  projectId,
  door,
  rowNumber,
  sets,
  subtotalUsd,
  subtotalIncomplete,
}: {
  projectId: string;
  door: DoorWithHardwareSet;
  rowNumber: number;
  sets: HardwareSetRow[];
  subtotalUsd: number | null;
  subtotalIncomplete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [state, formAction, formPending] = useActionState(
    updateDoor.bind(null, projectId, door.id),
    initialDoorActionResult
  );

  function handleDuplicate() {
    setActionError(null);
    startTransition(async () => {
      const result = await duplicateDoor(projectId, door.id);
      if (!result.ok) setActionError(result.error);
    });
  }

  function handleDelete() {
    if (!window.confirm(`Remove door ${door.door_number || "(untitled)"} from the register?`)) return;
    setActionError(null);
    startTransition(async () => {
      const result = await deleteDoor(projectId, door.id);
      if (!result.ok) setActionError(result.error);
    });
  }

  if (editing) {
    return (
      <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/40">
        <td colSpan={7} className="px-3 py-3">
          <form action={formAction} className="grid gap-3 sm:grid-cols-5">
            <div>
              <label className={labelClass} htmlFor={`floor-${door.id}`}>
                Floor
              </label>
              <input id={`floor-${door.id}`} type="text" name="floor" defaultValue={door.floor ?? ""} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={labelClass} htmlFor={`door-number-${door.id}`}>
                Door number
              </label>
              <input
                id={`door-number-${door.id}`}
                type="text"
                name="door_number"
                defaultValue={door.door_number}
                className={`${inputClass} mt-1`}
                autoFocus
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`location-${door.id}`}>
                Location
              </label>
              <input
                id={`location-${door.id}`}
                type="text"
                name="location_description"
                defaultValue={door.location_description ?? ""}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`set-${door.id}`}>
                Hardware set
              </label>
              <select
                id={`set-${door.id}`}
                name="hardware_set_id"
                defaultValue={door.hardware_set_id ?? ""}
                className={`${inputClass} mt-1`}
              >
                <option value="">— none —</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                    {s.name ? ` — ${s.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-3">
              <button
                type="submit"
                disabled={formPending}
                className="rounded-md bg-veridan-ink px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
              >
                {formPending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
              >
                Cancel
              </button>
            </div>
            {state.ok === false && (
              <p role="alert" className="sm:col-span-5 text-xs text-red-600">
                {state.error}
              </p>
            )}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-veridan-warm-gray-light last:border-b-0">
      <td className="px-3 py-2 text-xs text-veridan-warm-gray">{rowNumber}</td>
      <td className="px-3 py-2 text-sm text-veridan-ink">{door.floor || "—"}</td>
      <td className="px-3 py-2 text-sm font-medium text-veridan-ink">
        {door.door_number || <span className="italic text-veridan-warm-gray">(untitled)</span>}
      </td>
      <td className="px-3 py-2 text-sm text-veridan-warm-gray">{door.door_type ?? "—"}</td>
      <td className="px-3 py-2 text-sm text-veridan-ink">{door.location_description || "—"}</td>
      <td className="px-3 py-2 text-sm text-veridan-ink">
        {door.hardware_sets ? (
          door.hardware_sets.code
        ) : (
          <span className="text-xs font-medium uppercase tracking-wide text-red-600">No set</span>
        )}
        {subtotalUsd != null && (
          <span className="ml-1 text-xs text-veridan-warm-gray">
            ({formatUsd(subtotalUsd)}
            {subtotalIncomplete ? " · partial" : ""})
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={pending}
            className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft disabled:opacity-50"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink disabled:opacity-50"
          >
            {pending ? "…" : "Delete"}
          </button>
        </div>
        {actionError && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {actionError}
          </p>
        )}
      </td>
    </tr>
  );
}

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { HardwareSetRow } from "@/lib/supabase/types";
import { createDoor } from "./actions";
import { initialDoorActionResult } from "./actionState";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Fast-add row for the Door Register. Server action does the work; the
 * only client state is a ref remembering the last-submitted floor, so
 * repeated entry of doors on the same floor doesn't require retyping it
 * each time (§4 Task 15 "keeps focus flowing"). The door-number field is
 * always cleared and refocused after a successful add.
 */
export function DoorAddForm({ projectId, sets }: { projectId: string; sets: HardwareSetRow[] }) {
  const [state, formAction, pending] = useActionState(createDoor.bind(null, projectId), initialDoorActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  const floorInputRef = useRef<HTMLInputElement>(null);
  const doorNumberInputRef = useRef<HTMLInputElement>(null);
  const wasPending = useRef(false);
  const [lastFloor, setLastFloor] = useState("");

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      const floor = floorInputRef.current?.value ?? "";
      setLastFloor(floor);
      formRef.current?.reset();
      if (floorInputRef.current) floorInputRef.current.value = floor;
      doorNumberInputRef.current?.focus();
    }
    wasPending.current = pending;
  }, [pending, state.ok]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-5">
      <div>
        <label className={labelClass} htmlFor="new-door-floor">
          Floor
        </label>
        <input
          ref={floorInputRef}
          id="new-door-floor"
          type="text"
          name="floor"
          defaultValue={lastFloor}
          placeholder="e.g. 2"
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="new-door-number">
          Door number
        </label>
        <input
          ref={doorNumberInputRef}
          id="new-door-number"
          type="text"
          name="door_number"
          placeholder="e.g. DE01"
          className={`${inputClass} mt-1`}
          autoFocus
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="new-door-location">
          Location
        </label>
        <input
          id="new-door-location"
          type="text"
          name="location_description"
          placeholder="e.g. Main lobby"
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="new-door-set">
          Hardware set
        </label>
        <select id="new-door-set" name="hardware_set_id" defaultValue="" className={`${inputClass} mt-1`}>
          <option value="">— none —</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code}
              {s.name ? ` — ${s.name}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add door"}
        </button>
      </div>
      {state.ok === false && (
        <p role="alert" className="sm:col-span-5 text-xs text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}

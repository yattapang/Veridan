import type { DoorActionResult } from "./actions";

/**
 * Shared `useActionState` initial value for the door-register actions
 * (add/update door). Lives in a plain module (no "use server") because
 * Next.js 16 forbids non-async-function exports from a "use server" file —
 * this constant is consumed by multiple client components (DoorAddForm.tsx,
 * DoorRow.tsx), so it can't just be inlined once.
 */
export const initialDoorActionResult: DoorActionResult = { ok: true };

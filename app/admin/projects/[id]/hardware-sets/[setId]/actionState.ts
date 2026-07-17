import type { LineItemActionResult } from "./actions";

/**
 * Shared `useActionState` initial value for the hardware-set line-item
 * actions (add/update). Lives in a plain module (no "use server") because
 * Next.js 16 forbids non-async-function exports from a "use server" file —
 * this constant is consumed by multiple client components
 * (AddLineItemForm.tsx, LineItemRow.tsx), so it can't just be inlined once.
 */
export const initialLineItemActionResult: LineItemActionResult = { ok: true };

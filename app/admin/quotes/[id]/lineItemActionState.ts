import type { QuoteLineActionResult } from "./lineItemActions";

/**
 * Shared `useActionState` initial value for the line_item-mode quote line
 * actions (add/update). Lives in a plain module (no "use server") because
 * Next.js 16 forbids non-async-function exports from a "use server" file —
 * this constant is consumed by multiple client components
 * (QuoteLineRow.tsx, AddQuoteLineForm.tsx), so it can't just be inlined once.
 */
export const initialQuoteLineActionResult: QuoteLineActionResult = { ok: true };

import type { ProjectActionResult } from "./actions";

/**
 * Shared `useActionState` initial value for the project-level actions
 * (update project, create/clone hardware set, create door-register/line-item
 * quote). Lives in a plain module (no "use server") because Next.js 16
 * forbids non-async-function exports from a "use server" file — this
 * constant is consumed by multiple client components (ProjectHeaderForm,
 * AddHardwareSetForm, CloneSetForm, CreateQuoteButton,
 * CreateLineItemQuoteButton), so it can't just be inlined once.
 */
export const initialProjectActionResult: ProjectActionResult = { ok: true };

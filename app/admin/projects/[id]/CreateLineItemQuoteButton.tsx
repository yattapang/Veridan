"use client";

import { useActionState } from "react";
import { createLineItemQuote, initialProjectActionResult } from "./actions";

/**
 * Creates an empty line_item-mode quote (Task 17 — retrofit/simple jobs)
 * and redirects into its builder, where lines are added directly (no
 * hardware sets or door register required). Unlike the Door Register
 * button, this one has no hardware-set/door prerequisite — a bare project
 * is enough.
 */
export function CreateLineItemQuoteButton({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(
    createLineItemQuote.bind(null, projectId),
    initialProjectActionResult
  );

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-50"
      >
        {pending ? "Creating quote…" : "Create quote (Line-item mode)"}
      </button>
      {state.ok === false && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}

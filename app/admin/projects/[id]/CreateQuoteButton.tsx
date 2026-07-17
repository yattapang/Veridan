"use client";

import { useActionState } from "react";
import { createDoorRegisterQuote } from "./actions";
import { initialProjectActionResult } from "./actionState";

/**
 * Triggers the Door Register quote-materialization pipeline (Task 16). On
 * success the server action redirects into the new quote's builder, so this
 * button only ever renders an error if creation failed.
 */
export function CreateQuoteButton({
  projectId,
  disabled,
  disabledReason,
}: {
  projectId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState(
    createDoorRegisterQuote.bind(null, projectId),
    initialProjectActionResult
  );

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending || disabled}
        className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Creating quote…" : "Create quote (Door Register mode)"}
      </button>
      {disabled && disabledReason && (
        <p className="mt-2 text-xs text-veridan-warm-gray">{disabledReason}</p>
      )}
      {state.ok === false && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}

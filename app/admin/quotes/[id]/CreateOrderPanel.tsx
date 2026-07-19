"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createOrder, type CreateOrderResult } from "./orderActions";

const initialResult: CreateOrderResult = { ok: true, orderId: "" };

const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

/**
 * Task 52/53: "Create order" — shown on an accepted quote's page. Orders are
 * never auto-created; this is the one manual trigger. If an order already
 * exists for this quote, links straight to it instead of showing the button.
 *
 * Uses useActionState + a plain form (rather than a useTransition/onClick
 * button, per this file's sibling SimpleActionButton pattern in
 * WorkflowPanel.tsx) because createOrder redirects on success — matching how
 * createRevision (also a redirecting action) is wired in WorkflowPanel.tsx,
 * since Next's redirect() is only guaranteed to propagate cleanly through
 * the form-action invocation path.
 */
export function CreateOrderPanel({ quoteId, existingOrderId }: { quoteId: string; existingOrderId: string | null }) {
  const [state, formAction, pending] = useActionState(createOrder.bind(null, quoteId), initialResult);

  if (existingOrderId) {
    return (
      <Link
        href={`/admin/orders/${existingOrderId}`}
        className="text-sm font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
      >
        View order →
      </Link>
    );
  }

  return (
    <form action={formAction}>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Creating…" : "Create order"}
      </button>
      <p className="mt-2 text-xs text-veridan-warm-gray">
        Starts fulfillment tracking and actual-cost capture for this accepted quote.
      </p>
      {state.ok === false && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}

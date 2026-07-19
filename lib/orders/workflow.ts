/**
 * Order status transitions — PURE, no Supabase client, no I/O (Task 53).
 *
 * Mirrors the shape of lib/quotes/workflow.ts's `canTransition`: a pure guard
 * function the server action calls before issuing a conditional UPDATE, so
 * the actual concurrency safety comes from the DB-side single-winner
 * `.eq("status", from)` pattern (see app/admin/orders/[id]/actions.ts), not
 * from this function alone.
 *
 * Sequence (per Phase2_Plan §4 Task 53): forward-only through the CHECK
 * sequence, with skipping allowed (e.g. confirmed -> delivered directly is
 * fine — a founder may only find out about a shipment after it has already
 * cleared customs). 'closed' is the one exception: it requires the order to
 * already be 'delivered' — you cannot skip straight from, say, 'shipped' to
 * 'closed'. No backward transition is ever allowed.
 */

import type { OrderStatus } from "@/lib/supabase/types";

/** Sequence order — index = position in the forward-only chain. */
const SEQUENCE: OrderStatus[] = [
  "confirmed",
  "in_procurement",
  "shipped",
  "customs_cleared",
  "delivered",
  "closed",
];

function indexOf(status: OrderStatus): number {
  return SEQUENCE.indexOf(status);
}

export type OrderTransitionGuard = { ok: true; error?: undefined } | { ok: false; error: string };

/**
 * True/false + a human-readable reason. Rules:
 * - `to` must come strictly after `from` in SEQUENCE (forward-only, no-op
 *   "transition to the same status" is rejected too — that's just a stale
 *   double-submit, not a real transition).
 * - Skipping intermediate statuses is allowed EXCEPT landing on 'closed',
 *   which requires `from === 'delivered'` exactly.
 */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): OrderTransitionGuard {
  const fromIdx = indexOf(from);
  const toIdx = indexOf(to);
  if (fromIdx === -1 || toIdx === -1) {
    return { ok: false, error: "Unrecognized order status." };
  }
  if (toIdx <= fromIdx) {
    return { ok: false, error: `An order cannot move from "${from}" back to "${to}".` };
  }
  if (to === "closed" && from !== "delivered") {
    return { ok: false, error: "An order must be marked delivered before it can be closed." };
  }
  return { ok: true };
}

/** Every status strictly reachable from `from` (for populating a "move to" dropdown). */
export function reachableOrderStatuses(from: OrderStatus): OrderStatus[] {
  return SEQUENCE.filter((s) => canTransitionOrder(from, s).ok);
}

/** True once an order is 'closed' — actual_costs rows become immutable per Task 53's "deletable until order closed" rule. */
export function isOrderClosed(status: OrderStatus): boolean {
  return status === "closed";
}

/**
 * True when `current` is strictly before 'customs_cleared' in the sequence
 * (i.e. an order that has NOT yet reached or passed customs_cleared).
 * Used by the markCustomsCleared sync (app/admin/quotes/[id]/
 * workflowActions.ts) to decide whether an existing order row should be
 * advanced when a quote's customs event fires — see that file's header for
 * the full non-fatal, conditional-update argument. Reuses canTransitionOrder
 * rather than re-deriving the sequence, so the two never drift.
 */
export function isBeforeCustomsCleared(current: OrderStatus): boolean {
  return canTransitionOrder(current, "customs_cleared").ok;
}

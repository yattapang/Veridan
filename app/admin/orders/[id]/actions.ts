"use server";

/**
 * Order status transitions + actual-cost CRUD (Task 53). Mirrors the
 * single-winner conditional-update pattern used throughout the app
 * (app/admin/quotes/[id]/workflowActions.ts, app/admin/invoices/[id]/
 * actions.ts): a pure guard function decides whether a transition is legal,
 * and the actual concurrency safety comes from a `.eq("status", from)`
 * clause on the UPDATE, not from the guard alone.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canTransitionOrder, isOrderClosed } from "@/lib/orders/workflow";
import { ACTUAL_COST_CATEGORIES } from "@/lib/supabase/types";
import type { ActualCostCategory, OrderRow, OrderStatus } from "@/lib/supabase/types";

export type OrderActionResult = { ok: true; error?: undefined } | { ok: false; error: string };

function revalidateOrder(orderId: string) {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
}

async function loadOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<{ order: OrderRow } | { error: string }> {
  const { data, error } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) return { error: `Could not load the order: ${error.message}` };
  if (!data) return { error: "Order not found." };
  return { order: data as OrderRow };
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

const TIMESTAMP_COLUMN: Partial<Record<OrderStatus, string>> = {
  customs_cleared: "customs_cleared_at",
  delivered: "delivered_at",
  closed: "closed_at",
};

export async function transitionOrder(orderId: string, to: OrderStatus): Promise<OrderActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to change an order's status." };

  const loaded = await loadOrder(supabase, orderId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { order } = loaded;

  const guard = canTransitionOrder(order.status, to);
  if (!guard.ok) return { ok: false, error: guard.error };

  const extraColumn = TIMESTAMP_COLUMN[to];
  const updates: Record<string, unknown> = { status: to };
  if (extraColumn) updates[extraColumn] = new Date().toISOString();

  const { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", orderId)
    .eq("status", order.status)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: `Could not update the order: ${error.message}` };
  if (!data) {
    return {
      ok: false,
      error: "This order's status has already changed (refresh to see the current state).",
    };
  }

  revalidateOrder(orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Actual costs — immediate rows, no draft state; add/edit/delete are freely
// available until the order is closed (Task 53's "deletable until order
// closed" rule).
// ---------------------------------------------------------------------------

function parseActualCostForm(formData: FormData): { fields: Record<string, unknown> } | { error: string } {
  const category = String(formData.get("category") ?? "");
  if (!ACTUAL_COST_CATEGORIES.includes(category as ActualCostCategory)) {
    return { error: "Choose a valid cost category." };
  }

  const usdRaw = String(formData.get("amount_usd") ?? "").trim();
  const jmdRaw = String(formData.get("amount_jmd") ?? "").trim();
  const amountUsd = usdRaw === "" ? null : Number(usdRaw);
  const amountJmd = jmdRaw === "" ? null : Number(jmdRaw);
  if (amountUsd == null && amountJmd == null) {
    return { error: "Enter an amount in USD, JMD, or both." };
  }
  if (amountUsd != null && (!Number.isFinite(amountUsd) || amountUsd < 0)) {
    return { error: "USD amount must be a non-negative number." };
  }
  if (amountJmd != null && (!Number.isFinite(amountJmd) || amountJmd < 0)) {
    return { error: "JMD amount must be a non-negative number." };
  }

  const incurredDate = String(formData.get("incurred_date") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const description = String(formData.get("description") ?? "").trim() || null;
  const supplierId = String(formData.get("supplier_id") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  return {
    fields: {
      category,
      amount_usd: amountUsd,
      amount_jmd: amountJmd,
      incurred_date: incurredDate,
      description,
      supplier_id: supplierId,
      notes,
    },
  };
}

export async function addActualCost(
  orderId: string,
  _prevState: OrderActionResult,
  formData: FormData,
): Promise<OrderActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to record an actual cost." };

  const loaded = await loadOrder(supabase, orderId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (isOrderClosed(loaded.order.status)) {
    return { ok: false, error: "This order is closed — actual costs can no longer be added." };
  }

  const parsed = parseActualCostForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const { error } = await supabase.from("actual_costs").insert({
    order_id: orderId,
    ...parsed.fields,
    recorded_by: user.id,
  });
  if (error) return { ok: false, error: `Could not save the actual cost: ${error.message}` };

  revalidateOrder(orderId);
  return { ok: true };
}

export async function updateActualCost(
  orderId: string,
  costId: string,
  _prevState: OrderActionResult,
  formData: FormData,
): Promise<OrderActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to edit an actual cost." };

  const loaded = await loadOrder(supabase, orderId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (isOrderClosed(loaded.order.status)) {
    return { ok: false, error: "This order is closed — actual costs can no longer be edited." };
  }

  const parsed = parseActualCostForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const { data, error } = await supabase
    .from("actual_costs")
    .update(parsed.fields)
    .eq("id", costId)
    .eq("order_id", orderId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: `Could not update the actual cost: ${error.message}` };
  if (!data) return { ok: false, error: "That actual cost row was not found." };

  revalidateOrder(orderId);
  return { ok: true };
}

export async function deleteActualCost(orderId: string, costId: string): Promise<OrderActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to remove an actual cost." };

  const loaded = await loadOrder(supabase, orderId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  if (isOrderClosed(loaded.order.status)) {
    return { ok: false, error: "This order is closed — actual costs can no longer be removed." };
  }

  const { error } = await supabase.from("actual_costs").delete().eq("id", costId).eq("order_id", orderId);
  if (error) return { ok: false, error: `Could not remove the actual cost: ${error.message}` };

  revalidateOrder(orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Order notes (simple free-text field, no workflow implications)
// ---------------------------------------------------------------------------

export async function updateOrderNotes(
  orderId: string,
  _prevState: OrderActionResult,
  formData: FormData,
): Promise<OrderActionResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to edit order notes." };

  const notes = String(formData.get("notes") ?? "").trim() || null;
  const { error } = await supabase.from("orders").update({ notes }).eq("id", orderId);
  if (error) return { ok: false, error: `Could not save notes: ${error.message}` };

  revalidateOrder(orderId);
  return { ok: true };
}

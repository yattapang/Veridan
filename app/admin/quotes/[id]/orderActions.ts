"use server";

/**
 * "Create order" (Task 52/53) — the one and only place an `orders` row is
 * ever inserted. Per 20260718000004_orders_actuals.sql's header: an order is
 * NOT auto-created on quote acceptance; a founder clicks this button from an
 * accepted quote's page once fulfillment actually starts. This file is
 * separate from workflowActions.ts deliberately — it does not change any
 * quote status or invoice, it only creates a row in a different table, and
 * keeping it out of workflowActions.ts keeps that file's diff for this phase
 * limited to the single additive block documented in markCustomsCleared's
 * header.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

export type CreateOrderResult = { ok: true; orderId: string } | { ok: false; error: string };

/**
 * Creates an order for an accepted quote. Guarded so this can only be called
 * for a quote that is actually 'accepted', and idempotent via the DB's
 * `orders.quote_id` unique constraint — a double-click (or a second founder
 * clicking at the same time) cannot create two orders for the same quote;
 * the loser is redirected to the existing order instead of erroring.
 */
export async function createOrder(
  quoteId: string,
  // Unused — createOrder takes no form fields, but useActionState's action
  // signature (prevState, formData) requires the shape to match.
  ..._actionStateArgs: [CreateOrderResult, FormData]
): Promise<CreateOrderResult> {
  void _actionStateArgs;
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create an order." };

  const { data: quoteData, error: quoteError } = await supabase
    .from("quotes")
    .select("id, status, projects(id, company_id)")
    .eq("id", quoteId)
    .maybeSingle();
  if (quoteError) return { ok: false, error: `Could not load the quote: ${quoteError.message}` };
  const quote = quoteData as { id: string; status: string; projects: { id: string; company_id: string } | null } | null;
  if (!quote) return { ok: false, error: "Quote not found." };
  if (quote.status !== "accepted") {
    return { ok: false, error: "Only an accepted quote can have an order created for it." };
  }

  const { data, error } = await supabase
    .from("orders")
    .insert({
      quote_id: quote.id,
      project_id: quote.projects?.id ?? null,
      company_id: quote.projects?.company_id ?? null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    // uq on orders.quote_id (it's declared `unique` directly on the column) —
    // a concurrent double-click lands here; look up the winner's order id
    // and send the caller there instead of surfacing an error.
    if (error.code === "23505") {
      const { data: existing } = await supabase.from("orders").select("id").eq("quote_id", quote.id).maybeSingle();
      if (existing) {
        revalidatePath(`/admin/quotes/${quoteId}`);
        redirect(`/admin/orders/${(existing as { id: string }).id}`);
      }
    }
    return { ok: false, error: `Could not create the order: ${error.message}` };
  }

  revalidatePath(`/admin/quotes/${quoteId}`);
  revalidatePath("/admin/orders");
  redirect(`/admin/orders/${(data as { id: string }).id}`);
}

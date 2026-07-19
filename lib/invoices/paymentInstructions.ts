import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invoicePaymentInstructions as fallback } from "@/lib/site-content";
import {
  paymentInstructionFieldsConfigured,
  type PaymentInstructions,
} from "./paymentInstructionsCore";

/**
 * Loads the receiving-bank details from the admin-editable
 * `invoice_payment_instructions` business parameter (founder request
 * 2026-07-19 — bank details change over time and must be editable from
 * /admin/parameters, not code). Falls back to the lib/site-content.ts
 * placeholder constant when the parameter row is missing (e.g. migration not
 * yet applied), which keeps the send gate CLOSED — the fallback still
 * carries TODO markers.
 *
 * Deliberately read live at render/send time, never from the quote's frozen
 * parameters_snapshot: bank details are point-in-time banking facts, not
 * priced terms, and a client paying an old invoice must see current details.
 */
export async function loadPaymentInstructions(
  supabase: SupabaseClient
): Promise<PaymentInstructions> {
  const { data } = await supabase
    .from("business_parameters")
    .select("value")
    .eq("key", "invoice_payment_instructions")
    .maybeSingle();

  const table = (data?.value as { value?: Record<string, unknown> } | null)?.value;
  if (!table || typeof table !== "object") {
    return {
      bankName: fallback.bankName,
      accountName: fallback.accountName,
      accountNumber: fallback.accountNumber,
      branch: fallback.branch,
      routingOrSwift: fallback.routingOrSwift,
      note: fallback.note,
    };
  }

  const str = (key: string, fb: string): string => {
    const v = table[key];
    return typeof v === "string" && v.trim() !== "" ? v : fb;
  };

  return {
    bankName: str("bank_name", fallback.bankName),
    accountName: str("account_name", fallback.accountName),
    accountNumber: str("account_number", fallback.accountNumber),
    branch: str("branch", fallback.branch),
    routingOrSwift: str("routing_or_swift", fallback.routingOrSwift),
    note: str("note", fallback.note),
  };
}

/** Convenience: load + evaluate the send gate in one call. */
export async function loadConfiguredPaymentInstructions(
  supabase: SupabaseClient
): Promise<{ instructions: PaymentInstructions; configured: boolean }> {
  const instructions = await loadPaymentInstructions(supabase);
  return { instructions, configured: paymentInstructionFieldsConfigured(instructions) };
}

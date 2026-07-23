/**
 * Pure payment-instructions logic (no I/O — testable without a DB).
 *
 * MAJOR-3 fix (Phase 2C independent review), parameter-backed since
 * 2026-07-19: placeholder bank details must never reach a real client.
 * The send gate stays closed while any receiving-bank field still contains
 * "TODO" (case-insensitive) or is blank. `accountName` is deliberately NOT
 * checked — "Veridan Limited" is the real legal name, not a placeholder.
 */

export interface PaymentInstructions {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string;
  routingOrSwift: string;
  note: string;
}

export function paymentInstructionFieldsConfigured(
  instructions: PaymentInstructions
): boolean {
  const fieldsToCheck = [
    instructions.bankName,
    instructions.accountNumber,
    instructions.branch,
    instructions.routingOrSwift,
  ];
  return fieldsToCheck.every(
    (value) => value.trim() !== "" && !value.toUpperCase().includes("TODO")
  );
}

/**
 * The raw `snake_case` shape stored in the `invoice_payment_instructions`
 * business parameter's jsonb envelope
 * (`{"type":"table","value":{bank_name, account_name, account_number,
 * branch, routing_or_swift, note}}`, seeded by
 * supabase/migrations/20260719000001_invoice_payment_instructions_param.sql).
 * Keys here are load-bearing: they must exactly match what
 * lib/invoices/paymentInstructions.ts reads and what the admin editor's
 * per-field form (app/admin/parameters/ParameterRow.tsx) writes back.
 */
export interface PaymentInstructionsTableValue {
  bank_name: string;
  account_name: string;
  account_number: string;
  branch: string;
  routing_or_swift: string;
  note: string;
}

/**
 * Pure helper (no I/O): reads whatever the stored `value.value` object
 * looks like — including `null`/non-object/missing-key shapes, e.g. a
 * freshly-migrated row or a hand-edited textarea that dropped a field —
 * into a fully-populated table value, defaulting anything missing or
 * non-string to `""`. Used to pre-fill the admin form's six inputs.
 */
export function readPaymentInstructionsTableValue(
  raw: unknown
): PaymentInstructionsTableValue {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (key: string): string => (typeof obj[key] === "string" ? (obj[key] as string) : "");
  return {
    bank_name: str("bank_name"),
    account_name: str("account_name"),
    account_number: str("account_number"),
    branch: str("branch"),
    routing_or_swift: str("routing_or_swift"),
    note: str("note"),
  };
}

/**
 * Pure helper (no I/O): maps the stored `snake_case` table value to the
 * `camelCase` PaymentInstructions shape the send gate and PDF renderer use,
 * falling back field-by-field to `fallback` (the lib/site-content.ts
 * placeholder) when a field is missing/blank/non-string. Shared by
 * loadPaymentInstructions (the live-DB read path) and unit tests (the pure
 * path) so the two can't drift.
 */
export function paymentInstructionsFromTableValue(
  table: Record<string, unknown> | null | undefined,
  fallback: PaymentInstructions
): PaymentInstructions {
  const str = (key: string, fb: string): string => {
    const v = table?.[key];
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

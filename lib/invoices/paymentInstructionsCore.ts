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

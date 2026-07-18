/**
 * Payment status derivation — PURE, no Supabase client, no I/O (Task 49 UI,
 * built here alongside 46/47 since "Record payment" needs it).
 *
 * Only the payment-driven statuses (`partially_paid`/`paid`) are derived
 * here; `draft`/`issued`/`sent`/`void` are workflow states the caller
 * guards separately (see app/admin/invoices/[id]/actions.ts) — this module
 * never decides whether a payment CAN be recorded, only what status a
 * given amount-paid total implies once one has been.
 */

/** Compares two JMD amounts at cent precision to avoid float-equality false negatives/positives. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Given an invoice's total amount due and the sum of its recorded payments,
 * returns whichever of "partially_paid" | "paid" applies. Payments summing
 * to at least the amount due (including a harmless overpayment) resolve to
 * "paid"; anything less (but > 0, which the caller guarantees by only
 * calling this after inserting a payment row with a DB-enforced
 * `amount_jmd > 0` check) resolves to "partially_paid".
 */
export function nextInvoiceStatusAfterPayment(
  amountJmd: number,
  totalPaidJmd: number,
): "partially_paid" | "paid" {
  return toCents(totalPaidJmd) >= toCents(amountJmd) ? "paid" : "partially_paid";
}

/** Sums a list of recorded payment amounts (JMD), for feeding into nextInvoiceStatusAfterPayment. */
export function sumPayments(amounts: Array<number | null | undefined>): number {
  return amounts.reduce((sum: number, a) => sum + (typeof a === "number" && Number.isFinite(a) ? a : 0), 0);
}

/**
 * Remaining balance (JMD) = amount due minus payments recorded so far,
 * clamped at 0 (a harmless overpayment never shows as a negative balance).
 * Task 49's "remaining-balance display" helper — the invoice detail page and
 * payment-history running-balance column both call this rather than
 * re-deriving the subtraction inline.
 */
export function computeRemainingBalanceJmd(amountJmd: number, totalPaidSoFarJmd: number): number {
  const remainingCents = toCents(amountJmd) - toCents(totalPaidSoFarJmd);
  return remainingCents > 0 ? remainingCents / 100 : 0;
}

/**
 * True when a NEW payment of `newPaymentJmd` would exceed the invoice's
 * (unclamped) remaining balance — the server-side guard Task 49 requires
 * before `recordPayment` (app/admin/invoices/[id]/actions.ts) inserts a row.
 * Compares at cent precision for the same float-drift reason
 * nextInvoiceStatusAfterPayment does.
 */
export function paymentExceedsRemainingBalance(newPaymentJmd: number, remainingJmd: number): boolean {
  return toCents(newPaymentJmd) > toCents(remainingJmd);
}

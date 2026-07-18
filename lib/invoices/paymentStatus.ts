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

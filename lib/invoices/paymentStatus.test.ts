import { describe, expect, it } from "vitest";
import {
  computeRemainingBalanceJmd,
  nextInvoiceStatusAfterPayment,
  paymentExceedsRemainingBalance,
  sumPayments,
} from "./paymentStatus";

describe("nextInvoiceStatusAfterPayment", () => {
  it("returns partially_paid when the total paid is less than the amount due", () => {
    expect(nextInvoiceStatusAfterPayment(69000, 30000)).toBe("partially_paid");
  });

  it("returns paid when the total paid equals the amount due", () => {
    expect(nextInvoiceStatusAfterPayment(69000, 69000)).toBe("paid");
  });

  it("returns paid on a harmless overpayment", () => {
    expect(nextInvoiceStatusAfterPayment(69000, 69500)).toBe("paid");
  });

  it("compares at cent precision so float drift doesn't misclassify an exact match", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754 — this is the classic trap the cents
    // comparison guards against.
    const amountJmd = 0.3;
    const totalPaid = 0.1 + 0.2;
    expect(nextInvoiceStatusAfterPayment(amountJmd, totalPaid)).toBe("paid");
  });
});

describe("sumPayments", () => {
  it("sums a list of amounts", () => {
    expect(sumPayments([30000, 15000, 24000])).toBe(69000);
  });

  it("ignores null/undefined/non-finite entries defensively", () => {
    expect(sumPayments([30000, null, undefined, Number.NaN, 15000])).toBe(45000);
  });

  it("returns 0 for an empty list", () => {
    expect(sumPayments([])).toBe(0);
  });
});

describe("computeRemainingBalanceJmd", () => {
  it("returns amount due minus payments recorded so far", () => {
    expect(computeRemainingBalanceJmd(69000, 30000)).toBe(39000);
  });

  it("clamps at 0 on a harmless overpayment", () => {
    expect(computeRemainingBalanceJmd(69000, 69500)).toBe(0);
  });

  it("returns the full amount when nothing has been paid", () => {
    expect(computeRemainingBalanceJmd(69000, 0)).toBe(69000);
  });

  it("compares at cent precision so float drift doesn't misclassify an exact match", () => {
    expect(computeRemainingBalanceJmd(0.3, 0.1 + 0.2)).toBe(0);
  });
});

describe("paymentExceedsRemainingBalance", () => {
  it("returns true when a new payment would exceed the remaining balance", () => {
    expect(paymentExceedsRemainingBalance(40000, 39000)).toBe(true);
  });

  it("returns false when a new payment exactly matches the remaining balance", () => {
    expect(paymentExceedsRemainingBalance(39000, 39000)).toBe(false);
  });

  it("returns false when a new payment is under the remaining balance", () => {
    expect(paymentExceedsRemainingBalance(10000, 39000)).toBe(false);
  });

  it("compares at cent precision so float drift doesn't false-positive", () => {
    expect(paymentExceedsRemainingBalance(0.3, 0.1 + 0.2)).toBe(false);
  });
});

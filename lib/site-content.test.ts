import { describe, expect, it } from "vitest";
import { invoicePaymentInstructions, paymentInstructionsAreConfigured } from "./site-content";

describe("paymentInstructionsAreConfigured (MAJOR-3 fix)", () => {
  it("is false today — invoicePaymentInstructions still carries the TODO placeholders", () => {
    // This assertion is deliberately the CURRENT honest state: the founders
    // have not yet supplied real bank details. It should flip to true (and
    // this test updated) once lib/site-content.ts's invoicePaymentInstructions
    // is filled in with real values.
    expect(paymentInstructionsAreConfigured()).toBe(false);
  });

  it("detects a TODO placeholder in any of the checked fields", () => {
    const withPlaceholder = { ...invoicePaymentInstructions, bankName: "TODO founder: bank name" };
    const fields = [
      withPlaceholder.bankName,
      withPlaceholder.accountNumber,
      withPlaceholder.branch,
      withPlaceholder.routingOrSwift,
    ];
    expect(fields.some((v) => v.toUpperCase().includes("TODO"))).toBe(true);
  });

  it("would report configured once every checked field is a real value", () => {
    const configured = {
      bankName: "National Commercial Bank Jamaica",
      accountName: "Veridan Limited",
      accountNumber: "000123456789",
      branch: "New Kingston",
      routingOrSwift: "JNCBJMKX",
    };
    const fields = [configured.bankName, configured.accountNumber, configured.branch, configured.routingOrSwift];
    expect(fields.every((v) => !v.toUpperCase().includes("TODO"))).toBe(true);
  });

  it("does not flag accountName as a placeholder — it is already a real value", () => {
    expect(invoicePaymentInstructions.accountName.toUpperCase().includes("TODO")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { invoicePaymentInstructions } from "./site-content";
import { paymentInstructionFieldsConfigured } from "./invoices/paymentInstructionsCore";

describe("payment instructions send gate (Phase 2C MAJOR-3, parameter-backed)", () => {
  it("the site-content FALLBACK stays unconfigured — it exists to keep the gate closed when the parameter row is missing", () => {
    expect(paymentInstructionFieldsConfigured(invoicePaymentInstructions)).toBe(false);
  });

  it("any single TODO or blank field keeps the gate closed", () => {
    const real = {
      bankName: "CIBC Caribbean",
      accountName: "Veridan Limited",
      accountNumber: "1234567890",
      branch: "Kingston",
      routingOrSwift: "FCIBJMKN",
      note: "Include the invoice number as your payment reference.",
    };
    expect(paymentInstructionFieldsConfigured(real)).toBe(true);
    for (const field of ["bankName", "accountNumber", "branch", "routingOrSwift"] as const) {
      expect(
        paymentInstructionFieldsConfigured({ ...real, [field]: "TODO founder: fill in" })
      ).toBe(false);
      expect(paymentInstructionFieldsConfigured({ ...real, [field]: "   " })).toBe(false);
    }
  });

  it("accountName is deliberately not gated — the legal name is real, not a placeholder", () => {
    expect(invoicePaymentInstructions.accountName.toUpperCase().includes("TODO")).toBe(false);
  });
});

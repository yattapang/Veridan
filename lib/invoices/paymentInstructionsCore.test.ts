import { describe, expect, it } from "vitest";
import {
  paymentInstructionFieldsConfigured,
  paymentInstructionsFromTableValue,
  readPaymentInstructionsTableValue,
  type PaymentInstructions,
} from "./paymentInstructionsCore";

const fallback: PaymentInstructions = {
  bankName: "TODO founder: bank name",
  accountName: "Veridan Limited",
  accountNumber: "TODO founder: account number",
  branch: "TODO founder: branch",
  routingOrSwift: "TODO founder: routing / SWIFT code",
  note: "Please include the invoice number as your payment reference.",
};

describe("readPaymentInstructionsTableValue", () => {
  it("reads all six fields from a fully-populated stored value", () => {
    const stored = {
      bank_name: "National Commercial Bank",
      account_name: "Veridan Limited",
      account_number: "123456789",
      branch: "New Kingston",
      routing_or_swift: "JNCBJMKX",
      note: "Include invoice number",
    };
    expect(readPaymentInstructionsTableValue(stored)).toEqual(stored);
  });

  it("defaults missing or non-string fields to empty strings", () => {
    expect(readPaymentInstructionsTableValue({ bank_name: "NCB", branch: 42 })).toEqual({
      bank_name: "NCB",
      account_name: "",
      account_number: "",
      branch: "",
      routing_or_swift: "",
      note: "",
    });
  });

  it("defaults every field to empty when the stored value is missing or not an object", () => {
    const empty = {
      bank_name: "",
      account_name: "",
      account_number: "",
      branch: "",
      routing_or_swift: "",
      note: "",
    };
    expect(readPaymentInstructionsTableValue(null)).toEqual(empty);
    expect(readPaymentInstructionsTableValue(undefined)).toEqual(empty);
    expect(readPaymentInstructionsTableValue("not an object")).toEqual(empty);
  });
});

describe("the admin form -> save -> gate round trip", () => {
  // Mirrors app/admin/parameters/ParameterRow.tsx's PaymentInstructionsFields:
  // form values are read via readPaymentInstructionsTableValue, then saved
  // as JSON through updateParameter (a plain JSON.stringify/JSON.parse round
  // trip — nothing to fake here), and finally read back the way
  // lib/invoices/paymentInstructions.ts#loadPaymentInstructions does via
  // paymentInstructionsFromTableValue before the send gate checks it.
  function roundTrip(stored: unknown) {
    const formFields = readPaymentInstructionsTableValue(stored);
    const savedJson = JSON.stringify(formFields); // what the hidden "value" input submits
    const savedTableValue = JSON.parse(savedJson) as Record<string, unknown>;
    return paymentInstructionsFromTableValue(savedTableValue, fallback);
  }

  it("stays closed while the seeded TODO placeholders are untouched", () => {
    const seeded = {
      bank_name: "TODO founder: bank name",
      account_name: "Veridan Limited",
      account_number: "TODO founder: account number",
      branch: "TODO founder: branch",
      routing_or_swift: "TODO founder: routing / SWIFT code",
      note: "Please include the invoice number as your payment reference.",
    };
    expect(paymentInstructionFieldsConfigured(roundTrip(seeded))).toBe(false);
  });

  it("opens once all four gated fields are filled with real details", () => {
    const filledIn = {
      bank_name: "National Commercial Bank",
      account_name: "Veridan Limited",
      account_number: "123456789",
      branch: "New Kingston",
      routing_or_swift: "JNCBJMKX",
      note: "Please include the invoice number as your payment reference.",
    };
    expect(paymentInstructionFieldsConfigured(roundTrip(filledIn))).toBe(true);
  });

  it("stays closed if even one gated field is left blank", () => {
    const partiallyFilled = {
      bank_name: "National Commercial Bank",
      account_name: "Veridan Limited",
      account_number: "123456789",
      branch: "New Kingston",
      routing_or_swift: "", // still missing
      note: "",
    };
    expect(paymentInstructionFieldsConfigured(roundTrip(partiallyFilled))).toBe(false);
  });

  it("preserves the exact keys the PDF/loader expect through the round trip", () => {
    const filledIn = {
      bank_name: "National Commercial Bank",
      account_name: "Veridan Limited",
      account_number: "123456789",
      branch: "New Kingston",
      routing_or_swift: "JNCBJMKX",
      note: "Custom reference note",
    };
    const formFields = readPaymentInstructionsTableValue(filledIn);
    const savedTableValue = JSON.parse(JSON.stringify(formFields));
    expect(savedTableValue).toEqual(filledIn);
    expect(paymentInstructionsFromTableValue(savedTableValue, fallback)).toEqual({
      bankName: "National Commercial Bank",
      accountName: "Veridan Limited",
      accountNumber: "123456789",
      branch: "New Kingston",
      routingOrSwift: "JNCBJMKX",
      note: "Custom reference note",
    });
  });
});

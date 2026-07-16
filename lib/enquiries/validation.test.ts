import { describe, expect, it } from "vitest";
import {
  isValidEmail,
  isReasonableLineItemCount,
  normalizeSingleLine,
  normalizeMultiLine,
  MAX_LINE_ITEMS,
} from "./validation";

describe("isValidEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(isValidEmail("ken@veridanlimited.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co")).toBe(true);
  });

  it("rejects missing @ or domain", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("missing@domain")).toBe(false);
    expect(isValidEmail("@nodomain.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });

  it("rejects addresses containing whitespace", () => {
    expect(isValidEmail("has space@example.com")).toBe(false);
  });

  it("rejects addresses over the max length even if the pattern matches", () => {
    const local = "a".repeat(250);
    expect(isValidEmail(`${local}@x.com`)).toBe(false);
  });
});

describe("normalizeSingleLine", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeSingleLine("  hello  ", 100)).toBe("hello");
  });

  it("collapses internal whitespace runs, including newlines, to single spaces", () => {
    expect(normalizeSingleLine("hello\n\n  world\t\tagain", 100)).toBe("hello world again");
  });

  it("truncates to maxLength", () => {
    expect(normalizeSingleLine("abcdefghij", 5)).toBe("abcde");
  });

  it("returns empty string for non-string input", () => {
    expect(normalizeSingleLine(null, 100)).toBe("");
    expect(normalizeSingleLine(undefined, 100)).toBe("");
    // FormData.get() can return a File — must not throw.
    expect(normalizeSingleLine(new Blob(["x"]), 100)).toBe("");
  });
});

describe("normalizeMultiLine", () => {
  it("preserves internal line breaks", () => {
    expect(normalizeMultiLine("line one\nline two", 100)).toBe("line one\nline two");
  });

  it("trims only the outer edges", () => {
    expect(normalizeMultiLine("  \nline one\nline two\n  ", 100)).toBe("line one\nline two");
  });

  it("truncates to maxLength", () => {
    const input = "x".repeat(50);
    expect(normalizeMultiLine(input, 10)).toHaveLength(10);
  });

  it("returns empty string for non-string input", () => {
    expect(normalizeMultiLine(null, 100)).toBe("");
  });
});

describe("isReasonableLineItemCount", () => {
  it("accepts counts at or below the cap", () => {
    expect(isReasonableLineItemCount(0)).toBe(true);
    expect(isReasonableLineItemCount(1)).toBe(true);
    expect(isReasonableLineItemCount(MAX_LINE_ITEMS)).toBe(true);
  });

  it("rejects counts above the cap", () => {
    expect(isReasonableLineItemCount(MAX_LINE_ITEMS + 1)).toBe(false);
    expect(isReasonableLineItemCount(10000)).toBe(false);
  });
});

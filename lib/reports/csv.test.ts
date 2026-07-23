import { describe, expect, it } from "vitest";
import { buildCsv, buildCsvDocument, csvField } from "./csv";

describe("csvField", () => {
  it("leaves plain values unquoted", () => {
    expect(csvField("hello")).toBe("hello");
    expect(csvField(42)).toBe("42");
    expect(csvField(3.5)).toBe("3.5");
    expect(csvField(true)).toBe("true");
  });

  it("renders null/undefined as an empty field", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    expect(csvField("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("does not emit thousands separators for numbers (stays re-parseable)", () => {
    expect(csvField(1234567.89)).toBe("1234567.89");
  });

  it("neutralizes formula-injection triggers on string cells (MINOR-1 fix)", () => {
    // A scanned supplier name / description could start with one of these.
    expect(csvField("=HYPERLINK(\"http://evil\")")).toBe(
      "\"'=HYPERLINK(\"\"http://evil\"\")\""
    );
    expect(csvField("+1-800-CALL")).toBe("'+1-800-CALL");
    expect(csvField("-500 credit")).toBe("'-500 credit");
    expect(csvField("@handle")).toBe("'@handle");
  });

  it("does NOT prefix legitimate negative numbers (they must stay parseable)", () => {
    expect(csvField(-500)).toBe("-500");
    expect(csvField(-3.14)).toBe("-3.14");
  });
});

describe("buildCsv", () => {
  it("joins cells with commas and rows with CRLF", () => {
    const csv = buildCsv([
      ["Order", "Quoted", "Actual"],
      ["VQ-1", 100, 120],
    ]);
    expect(csv).toBe("Order,Quoted,Actual\r\nVQ-1,100,120");
  });

  it("escapes every problematic cell without corrupting neighbouring columns", () => {
    const csv = buildCsv([
      ["supplier", "note"],
      ["Bolt & Bar, Ltd.", 'has "quotes"\nand a newline'],
    ]);
    expect(csv).toBe('supplier,note\r\n"Bolt & Bar, Ltd.","has ""quotes""\nand a newline"');
  });
});

describe("buildCsvDocument", () => {
  it("prefixes a UTF-8 BOM and ends with a trailing CRLF", () => {
    const doc = buildCsvDocument([["a", "b"]]);
    expect(doc.charCodeAt(0)).toBe(0xfeff);
    expect(doc.endsWith("\r\n")).toBe(true);
    expect(doc).toBe("﻿a,b\r\n");
  });
});

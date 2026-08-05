import { describe, expect, it } from "vitest";
import { normalizeBrandsSupplied } from "./normalize";

describe("normalizeBrandsSupplied — backward-compatible brands_supplied shape normalization", () => {
  it("legacy string[] shape: every entry becomes { name, logoPath: null }", () => {
    expect(normalizeBrandsSupplied(["Assa Abloy", "Allegion"])).toEqual([
      { name: "Assa Abloy", logoPath: null },
      { name: "Allegion", logoPath: null },
    ]);
  });

  it("new object[] shape with a logo_path", () => {
    expect(
      normalizeBrandsSupplied([{ name: "Assa Abloy", logo_path: "assa-abloy/123-logo.png" }])
    ).toEqual([{ name: "Assa Abloy", logoPath: "assa-abloy/123-logo.png" }]);
  });

  it("new object[] shape without a logo (omitted, null, or empty string) normalizes to logoPath: null", () => {
    expect(normalizeBrandsSupplied([{ name: "Schlage" }])).toEqual([
      { name: "Schlage", logoPath: null },
    ]);
    expect(normalizeBrandsSupplied([{ name: "Schlage", logo_path: null }])).toEqual([
      { name: "Schlage", logoPath: null },
    ]);
    expect(normalizeBrandsSupplied([{ name: "Schlage", logo_path: "" }])).toEqual([
      { name: "Schlage", logoPath: null },
    ]);
  });

  it("mixed legacy strings and new objects in the same array (mid-migration row)", () => {
    expect(
      normalizeBrandsSupplied(["Consort", { name: "LCN", logo_path: "lcn/1-logo.png" }])
    ).toEqual([
      { name: "Consort", logoPath: null },
      { name: "LCN", logoPath: "lcn/1-logo.png" },
    ]);
  });

  it("empty array is valid (a founder may clear every brand)", () => {
    expect(normalizeBrandsSupplied([])).toEqual([]);
  });

  it("trims whitespace on names", () => {
    expect(normalizeBrandsSupplied(["  Assa Abloy  "])).toEqual([
      { name: "Assa Abloy", logoPath: null },
    ]);
  });

  it("rejects non-array input", () => {
    expect(normalizeBrandsSupplied(undefined)).toBeNull();
    expect(normalizeBrandsSupplied(null)).toBeNull();
    expect(normalizeBrandsSupplied("Assa Abloy")).toBeNull();
    expect(normalizeBrandsSupplied({ name: "Assa Abloy" })).toBeNull();
  });

  it("rejects a blank string entry", () => {
    expect(normalizeBrandsSupplied(["Assa Abloy", "   "])).toBeNull();
  });

  it("rejects an object entry with a blank/missing name", () => {
    expect(normalizeBrandsSupplied([{ name: "" }])).toBeNull();
    expect(normalizeBrandsSupplied([{ logo_path: "x/1-logo.png" }])).toBeNull();
  });

  it("rejects an entry that is neither a string nor a plain object", () => {
    expect(normalizeBrandsSupplied([5])).toBeNull();
    expect(normalizeBrandsSupplied([null])).toBeNull();
    expect(normalizeBrandsSupplied([["Assa Abloy"]])).toBeNull();
  });

  it("rejects a logo_path of the wrong type", () => {
    expect(normalizeBrandsSupplied([{ name: "Assa Abloy", logo_path: 5 }])).toBeNull();
    expect(normalizeBrandsSupplied([{ name: "Assa Abloy", logo_path: {} }])).toBeNull();
  });
});

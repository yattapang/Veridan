import { describe, expect, it } from "vitest";
import {
  catalogueCategoryMatchesProductCategory,
  filterCatalogueDocumentsForCategory,
  findProductCategoryByKey,
  resolveCategoryBrands,
} from "./matching";

const locksets = { key: "locksets", title: "Locksets & Deadbolts" };
const closers = { key: "closers", title: "Door Closers" };
const categories = [locksets, closers];

describe("findProductCategoryByKey", () => {
  it("returns the category with an exact key match", () => {
    expect(findProductCategoryByKey(categories, "closers")).toBe(closers);
  });

  it("returns undefined when no category has that key", () => {
    expect(findProductCategoryByKey(categories, "nope")).toBeUndefined();
  });
});

describe("catalogueCategoryMatchesProductCategory", () => {
  it("matches on an exact title match", () => {
    expect(catalogueCategoryMatchesProductCategory("Locksets & Deadbolts", locksets)).toBe(true);
  });

  it("matches on an exact key match", () => {
    expect(catalogueCategoryMatchesProductCategory("locksets", locksets)).toBe(true);
  });

  it("matches case- and whitespace-insensitively", () => {
    expect(catalogueCategoryMatchesProductCategory("  LOCKSETS & DEADBOLTS  ", locksets)).toBe(true);
    expect(catalogueCategoryMatchesProductCategory(" Locksets ", locksets)).toBe(true);
    expect(catalogueCategoryMatchesProductCategory("CLOSERS", closers)).toBe(true);
  });

  it("returns false for an unrelated category", () => {
    expect(catalogueCategoryMatchesProductCategory("Exit Devices", locksets)).toBe(false);
  });

  it("returns false for null, undefined, or blank input", () => {
    expect(catalogueCategoryMatchesProductCategory(null, locksets)).toBe(false);
    expect(catalogueCategoryMatchesProductCategory(undefined, locksets)).toBe(false);
    expect(catalogueCategoryMatchesProductCategory("   ", locksets)).toBe(false);
  });
});

describe("filterCatalogueDocumentsForCategory", () => {
  const docs = [
    { id: "1", category: "Locksets & Deadbolts" },
    { id: "2", category: "locksets" },
    { id: "3", category: "Door Closers" },
    { id: "4", category: null },
    { id: "5", category: "Exit Devices" },
  ];

  it("returns only the documents that forgivingly match the category", () => {
    const result = filterCatalogueDocumentsForCategory(docs, locksets);
    expect(result.map((d) => d.id)).toEqual(["1", "2"]);
  });

  it("returns an empty array when nothing matches", () => {
    const noMatchCategory = { key: "signage", title: "Bathroom & Amenity Signage" };
    expect(filterCatalogueDocumentsForCategory(docs, noMatchCategory)).toEqual([]);
  });

  it("returns an empty array for an empty document list", () => {
    expect(filterCatalogueDocumentsForCategory([], locksets)).toEqual([]);
  });
});

describe("resolveCategoryBrands", () => {
  const allBrands = [
    { name: "Assa Abloy", logoPath: "assa-abloy.png" },
    { name: "Schlage", logoPath: null },
    { name: "LCN", logoPath: "lcn.svg" },
  ];

  it("resolves each category brand name to its full entry, case-insensitively", () => {
    expect(resolveCategoryBrands(["assa abloy", "Schlage"], allBrands)).toEqual([
      { name: "Assa Abloy", logoPath: "assa-abloy.png" },
      { name: "Schlage", logoPath: null },
    ]);
  });

  it("preserves the category's own brand order, not allBrands' order", () => {
    expect(resolveCategoryBrands(["LCN", "Assa Abloy"], allBrands)).toEqual([
      { name: "LCN", logoPath: "lcn.svg" },
      { name: "Assa Abloy", logoPath: "assa-abloy.png" },
    ]);
  });

  it("falls back to a text-only entry when a brand name has no match", () => {
    expect(resolveCategoryBrands(["Von Duprin"], allBrands)).toEqual([
      { name: "Von Duprin", logoPath: null },
    ]);
  });

  it("returns an empty array when the category has no brands", () => {
    expect(resolveCategoryBrands([], allBrands)).toEqual([]);
  });
});

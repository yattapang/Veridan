import { describe, expect, it } from "vitest";
import {
  distinctBrands,
  distinctCategories,
  filterCatalogueDocuments,
  groupByBrand,
  groupByCategory,
  hasAnyCatalogueFilter,
  parseCatalogueFilterParams,
  type CatalogueGroupable,
} from "./grouping";

const docs: CatalogueGroupable[] = [
  { brand: "Assa Abloy", category: "locksets" },
  { brand: "Assa Abloy", category: "hinges" },
  { brand: "Schlage", category: "locksets" },
  { brand: "Consort", category: null },
];

describe("distinctBrands", () => {
  it("returns unique, sorted brand names", () => {
    expect(distinctBrands(docs)).toEqual(["Assa Abloy", "Consort", "Schlage"]);
  });

  it("returns an empty array for no documents", () => {
    expect(distinctBrands([])).toEqual([]);
  });
});

describe("distinctCategories", () => {
  it("returns unique, sorted categories and excludes null", () => {
    expect(distinctCategories(docs)).toEqual(["hinges", "locksets"]);
  });
});

describe("groupByBrand", () => {
  it("groups documents under their brand", () => {
    const groups = groupByBrand(docs);
    expect(groups.get("Assa Abloy")).toHaveLength(2);
    expect(groups.get("Schlage")).toHaveLength(1);
    expect(groups.get("Consort")).toHaveLength(1);
  });
});

describe("groupByCategory", () => {
  it("groups documents under their category", () => {
    const groups = groupByCategory(docs);
    expect(groups.get("locksets")).toHaveLength(2);
    expect(groups.get("hinges")).toHaveLength(1);
  });

  it("buckets a null category under 'Uncategorized' rather than dropping it", () => {
    const groups = groupByCategory(docs);
    expect(groups.get("Uncategorized")).toHaveLength(1);
    expect(groups.get("Uncategorized")?.[0].brand).toBe("Consort");
  });
});

describe("parseCatalogueFilterParams", () => {
  it("trims and defaults to empty strings", () => {
    expect(parseCatalogueFilterParams({ brand: " Assa Abloy ", category: "locksets" })).toEqual({
      brand: "Assa Abloy",
      category: "locksets",
    });
    expect(parseCatalogueFilterParams({})).toEqual({ brand: "", category: "" });
  });

  it("takes the first value when a param is an array", () => {
    expect(parseCatalogueFilterParams({ brand: ["Schlage", "LCN"] })).toEqual({
      brand: "Schlage",
      category: "",
    });
  });
});

describe("hasAnyCatalogueFilter", () => {
  it("is false when both filters are empty", () => {
    expect(hasAnyCatalogueFilter({ brand: "", category: "" })).toBe(false);
  });

  it("is true when either filter is set", () => {
    expect(hasAnyCatalogueFilter({ brand: "Schlage", category: "" })).toBe(true);
    expect(hasAnyCatalogueFilter({ brand: "", category: "locksets" })).toBe(true);
  });
});

describe("filterCatalogueDocuments", () => {
  it("returns everything when no filter is set", () => {
    expect(filterCatalogueDocuments(docs, {})).toHaveLength(4);
  });

  it("filters by brand", () => {
    const result = filterCatalogueDocuments(docs, { brand: "Assa Abloy" });
    expect(result).toHaveLength(2);
    expect(result.every((d) => d.brand === "Assa Abloy")).toBe(true);
  });

  it("filters by category", () => {
    const result = filterCatalogueDocuments(docs, { category: "locksets" });
    expect(result).toHaveLength(2);
  });

  it("combines brand AND category filters", () => {
    const result = filterCatalogueDocuments(docs, { brand: "Assa Abloy", category: "hinges" });
    expect(result).toHaveLength(1);
    expect(result[0].brand).toBe("Assa Abloy");
  });

  it("matches a null-category document only when the category filter is empty", () => {
    expect(filterCatalogueDocuments(docs, { brand: "Consort" })).toHaveLength(1);
    expect(filterCatalogueDocuments(docs, { brand: "Consort", category: "locksets" })).toHaveLength(0);
  });
});

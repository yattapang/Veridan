import { describe, expect, it } from "vitest";
import {
  buildCategoryOptions,
  computeCategoryUsageCounts,
  deriveCategorySlug,
  orderCategoriesForPublicFilter,
  swapSortOrder,
  usageCountFor,
  validateCategoryName,
  type CategoryNameCandidate,
} from "./categoryAdmin";

describe("deriveCategorySlug", () => {
  it("reuses the article slug rules (lowercase, hyphenated, punctuation stripped)", () => {
    expect(deriveCategorySlug("Fire Safety & Compliance")).toBe("fire-safety-compliance");
    expect(deriveCategorySlug("Grades & Standards")).toBe("grades-standards");
  });
});

describe("validateCategoryName", () => {
  const existing: CategoryNameCandidate[] = [
    { id: "1", name: "Hardware Fundamentals", slug: "hardware-fundamentals" },
    { id: "2", name: "Cost & Value", slug: "cost-value" },
  ];

  it("rejects a blank/whitespace-only name", () => {
    expect(validateCategoryName("", existing)).toEqual({ ok: false, error: expect.any(String) });
    expect(validateCategoryName("   ", existing)).toEqual({ ok: false, error: expect.any(String) });
  });

  it("accepts a new, non-colliding name and derives its slug", () => {
    const result = validateCategoryName("Project Stories", existing);
    expect(result).toEqual({ ok: true, name: "Project Stories", slug: "project-stories" });
  });

  it("trims surrounding whitespace before validating", () => {
    const result = validateCategoryName("  Project Stories  ", existing);
    expect(result).toEqual({ ok: true, name: "Project Stories", slug: "project-stories" });
  });

  it("rejects a case-insensitive duplicate name with a friendly error naming the collision", () => {
    const result = validateCategoryName("cost & value", existing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Cost & Value");
  });

  it("rejects two different names that would derive the same slug", () => {
    const result = validateCategoryName("Hardware, Fundamentals!", existing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("hardware-fundamentals");
      expect(result.error).toContain("Hardware Fundamentals");
    }
  });

  it("excludes the row being renamed from its own collision check", () => {
    const result = validateCategoryName("Hardware Fundamentals", existing, "1");
    expect(result).toEqual({ ok: true, name: "Hardware Fundamentals", slug: "hardware-fundamentals" });
  });

  it("still catches a collision with a DIFFERENT row during a rename", () => {
    const result = validateCategoryName("Cost & Value", existing, "1");
    expect(result.ok).toBe(false);
  });
});

describe("computeCategoryUsageCounts / usageCountFor", () => {
  it("counts articles by exact category string, ignoring null/blank", () => {
    const counts = computeCategoryUsageCounts([
      { category: "Product Spotlights" },
      { category: "Product Spotlights" },
      { category: "Project Stories" },
      { category: null },
    ]);
    expect(usageCountFor("Product Spotlights", counts)).toBe(2);
    expect(usageCountFor("Project Stories", counts)).toBe(1);
    expect(usageCountFor("Cost & Value", counts)).toBe(0);
  });

  it("returns 0 for a category no article uses", () => {
    const counts = computeCategoryUsageCounts([]);
    expect(usageCountFor("Anything", counts)).toBe(0);
  });
});

describe("buildCategoryOptions", () => {
  const managed = [{ name: "Hardware Fundamentals" }, { name: "Cost & Value" }];

  it("lists every managed category, none marked custom", () => {
    const options = buildCategoryOptions(managed, null);
    expect(options).toEqual([
      { value: "Hardware Fundamentals", label: "Hardware Fundamentals", isCustom: false },
      { value: "Cost & Value", label: "Cost & Value", isCustom: false },
    ]);
  });

  it("appends the article's current value as a custom option when it isn't managed", () => {
    const options = buildCategoryOptions(managed, "Some Legacy Category");
    expect(options).toHaveLength(3);
    expect(options[2]).toEqual({
      value: "Some Legacy Category",
      label: "Some Legacy Category (custom — not in the managed list)",
      isCustom: true,
    });
  });

  it("does not duplicate a current value that IS already a managed category", () => {
    const options = buildCategoryOptions(managed, "Cost & Value");
    expect(options).toHaveLength(2);
  });

  it("adds nothing extra for a null/blank current value", () => {
    expect(buildCategoryOptions(managed, null)).toHaveLength(2);
    expect(buildCategoryOptions(managed, undefined)).toHaveLength(2);
    expect(buildCategoryOptions(managed, "   ")).toHaveLength(2);
  });
});

describe("orderCategoriesForPublicFilter", () => {
  const managed = [
    { name: "Hardware Fundamentals", sort_order: 1 },
    { name: "Cost & Value", sort_order: 6 },
    { name: "Project Stories", sort_order: 8 },
  ];

  it("orders in-use categories by the managed sort_order", () => {
    const result = orderCategoriesForPublicFilter(
      ["Project Stories", "Hardware Fundamentals", "Cost & Value"],
      managed
    );
    expect(result).toEqual(["Hardware Fundamentals", "Cost & Value", "Project Stories"]);
  });

  it("places unmanaged/legacy values after every managed one, alphabetically", () => {
    const result = orderCategoriesForPublicFilter(
      ["Zzz Legacy", "Cost & Value", "Aaa Legacy"],
      managed
    );
    expect(result).toEqual(["Cost & Value", "Aaa Legacy", "Zzz Legacy"]);
  });

  it("falls back to plain alphabetical when the managed list is empty", () => {
    const result = orderCategoriesForPublicFilter(["Zebra", "Alpha"], []);
    expect(result).toEqual(["Alpha", "Zebra"]);
  });
});

describe("swapSortOrder", () => {
  const rows = [
    { id: "a", sort_order: 1 },
    { id: "b", sort_order: 2 },
    { id: "c", sort_order: 3 },
  ];

  it("swaps a middle row up with its predecessor", () => {
    expect(swapSortOrder(rows, "b", "up")).toEqual([
      { id: "b", sort_order: 1 },
      { id: "a", sort_order: 2 },
    ]);
  });

  it("swaps a middle row down with its successor", () => {
    expect(swapSortOrder(rows, "b", "down")).toEqual([
      { id: "b", sort_order: 3 },
      { id: "c", sort_order: 2 },
    ]);
  });

  it("returns null when moving the first row up", () => {
    expect(swapSortOrder(rows, "a", "up")).toBeNull();
  });

  it("returns null when moving the last row down", () => {
    expect(swapSortOrder(rows, "c", "down")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(swapSortOrder(rows, "nope", "up")).toBeNull();
  });

  it("swaps whatever pair is adjacent even when sort_order values tie", () => {
    const tied = [
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 1 },
    ];
    expect(swapSortOrder(tied, "b", "up")).toEqual([
      { id: "b", sort_order: 1 },
      { id: "a", sort_order: 1 },
    ]);
  });
});

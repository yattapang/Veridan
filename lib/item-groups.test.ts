import { describe, expect, it } from "vitest";
import {
  countProductsInGroup,
  groupByFinish,
  hasAnyFilter,
  isGradeValue,
  parseProductFilterParams,
  siblingAffordanceText,
  siblingsInGroup,
  validateMergeSelection,
} from "./item-groups";
import type { ProductWithSupplier } from "@/lib/supabase/types";

function makeProduct(overrides: Partial<ProductWithSupplier>): ProductWithSupplier {
  return {
    id: "p1",
    generic_category: "locksets",
    description: "Lever lockset",
    catalogue_ref: null,
    specified_finish: null,
    supplied_finish: null,
    manufacturer: null,
    product_ref: null,
    supplier_id: null,
    unit: "each",
    unit_cost: 10,
    cost_currency: "USD",
    source: "manual",
    active: true,
    item_group_id: null,
    finish_code: null,
    design_series: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    suppliers: null,
    ...overrides,
  };
}

describe("isGradeValue", () => {
  it("accepts the three ANSI/BHMA grades", () => {
    expect(isGradeValue("Grade 1")).toBe(true);
    expect(isGradeValue("Grade 2")).toBe(true);
    expect(isGradeValue("Grade 3")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isGradeValue("Grade 4")).toBe(false);
    expect(isGradeValue("")).toBe(false);
    expect(isGradeValue(null)).toBe(false);
    expect(isGradeValue(undefined)).toBe(false);
  });
});

describe("validateMergeSelection", () => {
  it("requires both ids", () => {
    expect(validateMergeSelection("", "b")).toEqual({ ok: false, error: expect.any(String) });
    expect(validateMergeSelection("a", "")).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects merging a group into itself", () => {
    const result = validateMergeSelection("a", "a");
    expect(result.ok).toBe(false);
  });

  it("accepts two distinct, non-empty ids", () => {
    expect(validateMergeSelection("a", "b")).toEqual({ ok: true });
  });
});

describe("countProductsInGroup", () => {
  it("counts only matching rows", () => {
    const products = [
      { item_group_id: "g1" },
      { item_group_id: "g2" },
      { item_group_id: "g1" },
      { item_group_id: null },
    ];
    expect(countProductsInGroup(products, "g1")).toBe(2);
    expect(countProductsInGroup(products, "g2")).toBe(1);
    expect(countProductsInGroup(products, "g3")).toBe(0);
  });
});

describe("siblingsInGroup", () => {
  it("returns products sharing the item_group_id, excluding self", () => {
    const products = [
      makeProduct({ id: "a", item_group_id: "g1" }),
      makeProduct({ id: "b", item_group_id: "g1" }),
      makeProduct({ id: "c", item_group_id: "g2" }),
      makeProduct({ id: "d", item_group_id: null }),
    ];
    const siblings = siblingsInGroup(products, "g1", "a");
    expect(siblings.map((p) => p.id)).toEqual(["b"]);
  });

  it("includes all matches when no exclusion id given", () => {
    const products = [makeProduct({ id: "a", item_group_id: "g1" }), makeProduct({ id: "b", item_group_id: "g1" })];
    expect(siblingsInGroup(products, "g1")).toHaveLength(2);
  });
});

describe("groupByFinish", () => {
  it("buckets products by finish_code", () => {
    const products = [
      makeProduct({ id: "a", finish_code: "US32D" }),
      makeProduct({ id: "b", finish_code: "US32D" }),
      makeProduct({ id: "c", finish_code: "US26D" }),
    ];
    const groups = groupByFinish(products);
    expect(groups.get("US32D")).toHaveLength(2);
    expect(groups.get("US26D")).toHaveLength(1);
  });

  it("buckets missing/blank finish_code under the em-dash label", () => {
    const products = [makeProduct({ id: "a", finish_code: null }), makeProduct({ id: "b", finish_code: "  " })];
    const groups = groupByFinish(products);
    expect(groups.get("—")).toHaveLength(2);
  });
});

describe("siblingAffordanceText", () => {
  it("returns null when there are no siblings", () => {
    expect(siblingAffordanceText(0)).toBeNull();
  });

  it("singularizes for exactly one sibling", () => {
    expect(siblingAffordanceText(1)).toBe("1 other supplier/finish offers this item");
  });

  it("pluralizes for more than one sibling", () => {
    expect(siblingAffordanceText(3)).toBe("3 other suppliers/finishes offer this item");
  });
});

describe("parseProductFilterParams", () => {
  it("trims values and takes the first entry of array params", () => {
    const parsed = parseProductFilterParams({
      q: "  lockset  ",
      category: ["locksets", "closers"],
      grade: "Grade 1",
      finish_code: undefined,
    });
    expect(parsed.q).toBe("lockset");
    expect(parsed.category).toBe("locksets");
    expect(parsed.grade).toBe("Grade 1");
    expect(parsed.finishCode).toBe("");
  });

  it("defaults every field to an empty string when absent", () => {
    const parsed = parseProductFilterParams({});
    expect(parsed).toEqual({
      q: "",
      category: "",
      manufacturer: "",
      supplierId: "",
      itemGroupId: "",
      grade: "",
      finishCode: "",
    });
  });
});

describe("hasAnyFilter", () => {
  it("is false when every field is blank", () => {
    expect(
      hasAnyFilter({ q: "", category: "", manufacturer: "", supplierId: "", itemGroupId: "", grade: "", finishCode: "" })
    ).toBe(false);
  });

  it("is true when any single field is set", () => {
    expect(
      hasAnyFilter({ q: "", category: "", manufacturer: "", supplierId: "", itemGroupId: "g1", grade: "", finishCode: "" })
    ).toBe(true);
  });
});

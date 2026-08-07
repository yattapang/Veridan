import { describe, expect, it } from "vitest";
import {
  computeExpenseCategoryUsageCounts,
  deriveExpenseCategoryName,
  describeCategoryDeletion,
  expenseCategoryUsageCountFor,
  validateExpenseCategoryRename,
  validateNewExpenseCategory,
  type ExpenseCategoryCandidate,
} from "./categoryAdmin";

const EXISTING: ExpenseCategoryCandidate[] = [
  { id: "1", name: "rent_utilities", label: "Rent & Utilities" },
  { id: "2", name: "salaries_wages", label: "Salaries & Wages" },
];

describe("deriveExpenseCategoryName", () => {
  it("produces a snake_case machine key", () => {
    expect(deriveExpenseCategoryName("Professional Fees")).toBe("professional_fees");
  });

  it("treats an ampersand as a separator, matching the migration's seeded keys exactly", () => {
    expect(deriveExpenseCategoryName("Rent & Utilities")).toBe("rent_utilities");
    expect(deriveExpenseCategoryName("Salaries & Wages")).toBe("salaries_wages");
    expect(deriveExpenseCategoryName("Bank Charges & Interest")).toBe("bank_charges_interest");
  });

  it("strips accents instead of losing the letter", () => {
    expect(deriveExpenseCategoryName("Café Supplies")).toBe("cafe_supplies");
  });

  it("collapses runs of punctuation and trims leading/trailing separators", () => {
    expect(deriveExpenseCategoryName("  Bank -- Charges!! ")).toBe("bank_charges");
  });

  it("returns an empty string when there is nothing usable", () => {
    expect(deriveExpenseCategoryName("!!!")).toBe("");
  });
});

describe("validateNewExpenseCategory", () => {
  it("returns the trimmed label and the derived key", () => {
    const result = validateNewExpenseCategory("  Marketing & Advertising  ", EXISTING);
    expect(result).toEqual({
      ok: true,
      name: "marketing_advertising",
      label: "Marketing & Advertising",
    });
  });

  it("requires a name", () => {
    expect(validateNewExpenseCategory("   ", EXISTING)).toEqual({ ok: false, error: "Name is required." });
  });

  it("rejects a duplicate label, case-insensitively, naming the collision", () => {
    const result = validateNewExpenseCategory("rent & utilities", EXISTING);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Rent & Utilities");
  });

  it("rejects a different label that derives the same internal key", () => {
    const result = validateNewExpenseCategory("Rent / Utilities!", EXISTING);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("rent_utilities");
  });

  it("rejects a name with no usable characters", () => {
    const result = validateNewExpenseCategory("***", EXISTING);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("at least one letter or number");
  });

  it("accepts anything into an empty taxonomy", () => {
    expect(validateNewExpenseCategory("Other", []).ok).toBe(true);
  });
});

describe("validateExpenseCategoryRename", () => {
  it("returns only the label — never a new machine key", () => {
    const result = validateExpenseCategoryRename("Rent, Power & Water", EXISTING, "1");
    expect(result).toEqual({ ok: true, label: "Rent, Power & Water" });
    expect(result).not.toHaveProperty("name");
  });

  it("lets a category keep its own label (renaming to itself is not a collision)", () => {
    expect(validateExpenseCategoryRename("Rent & Utilities", EXISTING, "1").ok).toBe(true);
  });

  it("still rejects colliding with a DIFFERENT category's label", () => {
    const result = validateExpenseCategoryRename("Salaries & Wages", EXISTING, "1");
    expect(result.ok).toBe(false);
  });

  it("allows a rename whose derived key would collide, because the key is never rewritten", () => {
    // "Salaries and Wages" derives salaries_and_wages, which is irrelevant —
    // a rename touches the label only, so there is no key to collide.
    expect(validateExpenseCategoryRename("Staff Costs", EXISTING, "1").ok).toBe(true);
  });

  it("requires a name", () => {
    expect(validateExpenseCategoryRename("  ", EXISTING, "1")).toEqual({ ok: false, error: "Name is required." });
  });
});

describe("computeExpenseCategoryUsageCounts", () => {
  it("counts by category id", () => {
    const counts = computeExpenseCategoryUsageCounts([
      { expense_category_id: "1" },
      { expense_category_id: "1" },
      { expense_category_id: "2" },
    ]);
    expect(expenseCategoryUsageCountFor("1", counts)).toBe(2);
    expect(expenseCategoryUsageCountFor("2", counts)).toBe(1);
  });

  it("reports zero for a category nothing references", () => {
    expect(expenseCategoryUsageCountFor("99", computeExpenseCategoryUsageCounts([]))).toBe(0);
  });
});

describe("describeCategoryDeletion", () => {
  it("allows deleting an unused category and says nothing will change", () => {
    const verdict = describeCategoryDeletion("Depreciation", 0);
    expect(verdict.allowed).toBe(true);
    expect(verdict.message).toContain("No expenses use it");
  });

  it("BLOCKS deleting a category that is in use — the FK is ON DELETE RESTRICT", () => {
    const verdict = describeCategoryDeletion("Rent & Utilities", 4);
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("cannot be deleted");
    expect(verdict.message).toContain("4 expenses use it");
  });

  it("uses singular wording for exactly one referencing expense", () => {
    const verdict = describeCategoryDeletion("Insurance", 1);
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("1 expense uses it");
  });
});

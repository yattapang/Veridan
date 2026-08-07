import { describe, expect, it } from "vitest";
import {
  buildCurrentFxRate,
  describeCurrentFxRate,
  expenseAmountJmd,
  filterExpenses,
  parseExpenseInput,
  parseExpensePaymentFilter,
  type ExpenseInputRaw,
} from "./expense";

const RATE = buildCurrentFxRate(162, 3); // effective 166.86 JMD per USD

function rawInput(overrides: Partial<ExpenseInputRaw> = {}): ExpenseInputRaw {
  return {
    expenseCategoryId: "cat-1",
    description: "Office rent — August",
    vendor: "",
    amountJmd: "150000",
    amountUsd: "",
    incurredDate: "2026-08-01",
    paidDate: "",
    paymentMethod: "",
    reference: "",
    notes: "",
    ...overrides,
  };
}

describe("buildCurrentFxRate", () => {
  it("applies the risk buffer on top of the bank sell rate", () => {
    const fx = buildCurrentFxRate(162, 3);
    expect(fx.effectiveRate).toBeCloseTo(166.86, 6);
    expect(fx.available).toBe(true);
  });

  it("treats a zero buffer as no uplift", () => {
    expect(buildCurrentFxRate(160, 0).effectiveRate).toBe(160);
  });

  it("is unavailable when the bank rate is missing, zero, negative or not finite", () => {
    for (const bad of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const fx = buildCurrentFxRate(bad as number | null | undefined, 3);
      expect(fx.available).toBe(false);
      expect(fx.effectiveRate).toBe(0);
    }
  });

  it("falls back to a zero buffer rather than failing when only the buffer is missing", () => {
    const fx = buildCurrentFxRate(162, null);
    expect(fx.available).toBe(true);
    expect(fx.effectiveRate).toBe(162);
  });

  it("describes an unavailable rate as unavailable instead of printing a fake number", () => {
    expect(describeCurrentFxRate(buildCurrentFxRate(null, null))).toContain("No current USD-JMD rate");
    expect(describeCurrentFxRate(RATE)).toContain("166.86");
  });
});

describe("expenseAmountJmd", () => {
  it("uses the row's own JMD value when present, ignoring any USD sibling", () => {
    expect(expenseAmountJmd({ amountJmd: 5000, amountUsd: 999 }, RATE)).toBe(5000);
  });

  it("converts a USD-only row at the CURRENT effective rate", () => {
    expect(expenseAmountJmd({ amountJmd: null, amountUsd: 100 }, RATE)).toBeCloseTo(16686, 2);
  });

  it("returns null for a USD-only row when no current rate is configured", () => {
    expect(expenseAmountJmd({ amountJmd: null, amountUsd: 100 }, buildCurrentFxRate(null, null))).toBeNull();
  });

  it("returns null when neither amount is present", () => {
    expect(expenseAmountJmd({ amountJmd: null, amountUsd: null }, RATE)).toBeNull();
  });

  it("moves with the rate — the same USD expense converts differently once the parameter changes", () => {
    const row = { amountJmd: null, amountUsd: 100 };
    const before = expenseAmountJmd(row, buildCurrentFxRate(162, 3));
    const after = expenseAmountJmd(row, buildCurrentFxRate(170, 3));
    expect(before).not.toBe(after);
    expect(after!).toBeGreaterThan(before!);
  });
});

describe("parseExpenseInput", () => {
  const today = "2026-08-07";

  it("normalizes a valid JMD-only expense", () => {
    const result = parseExpenseInput(rawInput(), today);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields).toMatchObject({
      expense_category_id: "cat-1",
      description: "Office rent — August",
      amount_jmd: 150000,
      amount_usd: null,
      incurred_date: "2026-08-01",
      paid_date: null,
    });
  });

  it("blanks optional text fields to null rather than empty strings", () => {
    const result = parseExpenseInput(rawInput({ vendor: "  ", reference: "", notes: "   " }), today);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.vendor).toBeNull();
    expect(result.fields.reference).toBeNull();
    expect(result.fields.notes).toBeNull();
  });

  it("requires a category", () => {
    const result = parseExpenseInput(rawInput({ expenseCategoryId: "" }), today);
    expect(result).toEqual({ ok: false, error: "Choose an expense category." });
  });

  it("requires a description", () => {
    const result = parseExpenseInput(rawInput({ description: "   " }), today);
    expect(result.ok).toBe(false);
  });

  it("requires at least one amount, mirroring the DB check constraint", () => {
    const result = parseExpenseInput(rawInput({ amountJmd: "", amountUsd: "" }), today);
    expect(result).toEqual({ ok: false, error: "Enter an amount in JMD, USD, or both." });
  });

  it("accepts both amounts together", () => {
    const result = parseExpenseInput(rawInput({ amountJmd: "1000", amountUsd: "6" }), today);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.amount_jmd).toBe(1000);
    expect(result.fields.amount_usd).toBe(6);
  });

  it("rejects negative and non-numeric amounts", () => {
    expect(parseExpenseInput(rawInput({ amountJmd: "-1" }), today).ok).toBe(false);
    expect(parseExpenseInput(rawInput({ amountJmd: "abc" }), today).ok).toBe(false);
    expect(parseExpenseInput(rawInput({ amountJmd: "", amountUsd: "-2" }), today).ok).toBe(false);
  });

  it("defaults a blank incurred date to today", () => {
    const result = parseExpenseInput(rawInput({ incurredDate: "" }), today);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.incurred_date).toBe(today);
  });

  it("rejects a malformed date", () => {
    expect(parseExpenseInput(rawInput({ incurredDate: "01/08/2026" }), today).ok).toBe(false);
    expect(parseExpenseInput(rawInput({ paidDate: "soon" }), today).ok).toBe(false);
  });

  it("keeps a blank paid date as null — an unpaid expense, not one paid today", () => {
    const result = parseExpenseInput(rawInput({ paidDate: "" }), today);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.paid_date).toBeNull();
  });

  it("allows a paid date earlier than the incurred date (prepayments are real)", () => {
    const result = parseExpenseInput(
      rawInput({ incurredDate: "2026-08-01", paidDate: "2026-07-15" }),
      today,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.paid_date).toBe("2026-07-15");
  });
});

describe("parseExpensePaymentFilter", () => {
  it("recognises the two real filters and defaults everything else to all", () => {
    expect(parseExpensePaymentFilter("paid")).toBe("paid");
    expect(parseExpensePaymentFilter("unpaid")).toBe("unpaid");
    expect(parseExpensePaymentFilter("all")).toBe("all");
    expect(parseExpensePaymentFilter("nonsense")).toBe("all");
    expect(parseExpensePaymentFilter(null)).toBe("all");
    expect(parseExpensePaymentFilter(undefined)).toBe("all");
  });
});

describe("filterExpenses", () => {
  const expenses = [
    { id: "a", expense_category_id: "rent", incurred_date: "2026-01-15", paid_date: "2026-01-20" },
    { id: "b", expense_category_id: "rent", incurred_date: "2026-02-15", paid_date: null },
    { id: "c", expense_category_id: "software", incurred_date: "2026-03-01", paid_date: "2026-03-02" },
    { id: "d", expense_category_id: "software", incurred_date: "2025-12-31", paid_date: "2026-01-05" },
  ];

  it("returns everything when no filters are given", () => {
    expect(filterExpenses(expenses, {})).toHaveLength(4);
  });

  it("filters on incurred_date, not paid_date — an unpaid bill still shows in its own month", () => {
    const result = filterExpenses(expenses, { startIso: "2026-02-01", endIso: "2026-02-28" });
    expect(result.map((e) => e.id)).toEqual(["b"]);
  });

  it("excludes a row incurred before the range even though it was paid inside it", () => {
    const result = filterExpenses(expenses, { startIso: "2026-01-01", endIso: "2026-01-31" });
    expect(result.map((e) => e.id)).toEqual(["a"]);
  });

  it("filters by category", () => {
    expect(filterExpenses(expenses, { categoryId: "software" }).map((e) => e.id)).toEqual(["c", "d"]);
  });

  it("filters to paid only and unpaid only", () => {
    expect(filterExpenses(expenses, { payment: "paid" }).map((e) => e.id)).toEqual(["a", "c", "d"]);
    expect(filterExpenses(expenses, { payment: "unpaid" }).map((e) => e.id)).toEqual(["b"]);
  });

  it("combines every filter", () => {
    const result = filterExpenses(expenses, {
      startIso: "2026-01-01",
      endIso: "2026-12-31",
      categoryId: "rent",
      payment: "unpaid",
    });
    expect(result.map((e) => e.id)).toEqual(["b"]);
  });

  it("returns an empty array for empty input", () => {
    expect(filterExpenses([], { startIso: "2026-01-01", endIso: "2026-12-31" })).toEqual([]);
  });
});

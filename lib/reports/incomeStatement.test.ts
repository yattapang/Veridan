import { describe, expect, it } from "vitest";
import { buildCurrentFxRate } from "../expenses/expense";
import { parseReportBasis } from "./basis";
import {
  buildIncomeStatement,
  computeOperatingExpensesByMonth,
  costRowsForBasis,
  expenseDateForBasis,
  gctCollectedJmd,
  invoiceRevenueShare,
  mergeOperatingExpenseCategories,
  revenueRowsForBasis,
  roundJmd,
  type CostOfSalesInput,
  type IncomeStatementInputs,
  type IssuedInvoiceInput,
  type OperatingExpenseInput,
  type PaymentRevenueInput,
} from "./incomeStatement";
import type { ReportDateRange } from "./period";

const RANGE: ReportDateRange = { startIso: "2026-01-01", endIso: "2026-03-31" };
const RATE = 166.86; // JMD per USD, an order's locked quote rate
const ORDER_RATES = { o1: RATE };
const FX = buildCurrentFxRate(162, 3); // current rate, also 166.86
const NO_FX = buildCurrentFxRate(null, null);

/**
 * An invoice with NO GCT (`gct_enabled` is false today, so this is the live
 * shape): gross == revenue. `withGct` below builds the other case.
 */
function invoice(overrides: Partial<IssuedInvoiceInput> = {}): IssuedInvoiceInput {
  const revenueJmd = overrides.revenueJmd ?? 1_000_000;
  return {
    grossAmountJmd: revenueJmd,
    revenueJmd,
    gctJmd: 0,
    issuedDateIso: "2026-01-10",
    orderId: "o1",
    quoteRef: "VQ-2026-001",
    invoiceNumber: "VI-2026-001",
    ...overrides,
  };
}

function payment(overrides: Partial<PaymentRevenueInput> = {}): PaymentRevenueInput {
  const amountJmd = overrides.amountJmd ?? 400_000;
  return {
    amountJmd,
    revenueJmd: amountJmd,
    gctJmd: 0,
    paidAtIso: "2026-02-05",
    orderId: "o1",
    quoteRef: "VQ-2026-001",
    invoiceNumber: "VI-2026-001",
    ...overrides,
  };
}

/** An invoice raised WITH 15% GCT: gross = subtotal x 1.15, and only the subtotal is revenue. */
function invoiceWithGct(subtotalJmd: number, overrides: Partial<IssuedInvoiceInput> = {}): IssuedInvoiceInput {
  const gctJmd = roundJmd(subtotalJmd * 0.15);
  return invoice({
    grossAmountJmd: roundJmd(subtotalJmd + gctJmd),
    revenueJmd: subtotalJmd,
    gctJmd,
    ...overrides,
  });
}

/** A payment against a 15%-GCT invoice, pro-rated the way lib/reports/load.ts does. */
function paymentWithGct(amountJmd: number, overrides: Partial<PaymentRevenueInput> = {}): PaymentRevenueInput {
  const revenueJmd = roundJmd(amountJmd * invoiceRevenueShare(100, 115));
  return payment({ amountJmd, revenueJmd, gctJmd: roundJmd(amountJmd - revenueJmd), ...overrides });
}

function cost(overrides: Partial<CostOfSalesInput> = {}): CostOfSalesInput {
  return {
    orderId: "o1",
    category: "hardware",
    amountUsd: null,
    amountJmd: 600_000,
    incurredDateIso: "2026-01-15",
    paidDateIso: "2026-02-15",
    quoteRef: "VQ-2026-001",
    ...overrides,
  };
}

function expense(overrides: Partial<OperatingExpenseInput> = {}): OperatingExpenseInput {
  return {
    categoryName: "rent_utilities",
    categoryLabel: "Rent & Utilities",
    amountJmd: 150_000,
    amountUsd: null,
    incurredDateIso: "2026-01-01",
    paidDateIso: "2026-01-05",
    ...overrides,
  };
}

function inputs(overrides: Partial<IncomeStatementInputs> = {}): IncomeStatementInputs {
  return {
    issuedInvoices: [],
    payments: [],
    costs: [],
    expenses: [],
    rateByOrderId: ORDER_RATES,
    fx: FX,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("parseReportBasis", () => {
  it("defaults to accrual", () => {
    expect(parseReportBasis(undefined)).toBe("accrual");
    expect(parseReportBasis(null)).toBe("accrual");
    expect(parseReportBasis("")).toBe("accrual");
    expect(parseReportBasis("nonsense")).toBe("accrual");
  });

  it("recognises cash, including from a repeated query param", () => {
    expect(parseReportBasis("cash")).toBe("cash");
    expect(parseReportBasis(["cash", "accrual"])).toBe("cash");
  });
});

describe("revenueRowsForBasis", () => {
  const invoices = [invoice({ revenueJmd: 1_000_000 })];
  const payments = [payment({ amountJmd: 400_000 })];

  it("uses ISSUED INVOICES on the accrual basis, dated by issue date", () => {
    const rows = revenueRowsForBasis("accrual", invoices, payments);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountJmd).toBe(1_000_000);
    expect(rows[0].paidAtIso).toBe("2026-01-10");
  });

  it("uses PAYMENTS on the cash basis, and never touches the invoice rows", () => {
    const rows = revenueRowsForBasis("cash", invoices, payments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      amountJmd: 400_000,
      paidAtIso: "2026-02-05",
      orderId: "o1",
      quoteRef: "VQ-2026-001",
      invoiceNumber: "VI-2026-001",
    });
  });

  it("never double-counts — the two sources are alternatives, never summed", () => {
    const accrual = revenueRowsForBasis("accrual", invoices, payments);
    const cash = revenueRowsForBasis("cash", invoices, payments);
    expect(accrual).toHaveLength(1);
    expect(cash).toHaveLength(1);
  });

  it("handles empty inputs on both bases", () => {
    expect(revenueRowsForBasis("accrual", [], [])).toEqual([]);
    expect(revenueRowsForBasis("cash", [], [])).toEqual([]);
  });
});

describe("costRowsForBasis", () => {
  const costs = [
    cost({ amountJmd: 100, incurredDateIso: "2026-01-15", paidDateIso: "2026-02-15" }),
    cost({ amountJmd: 200, incurredDateIso: "2026-01-20", paidDateIso: null }),
  ];

  it("dates every cost by incurred_date on the accrual basis, including unpaid ones", () => {
    const rows = costRowsForBasis("accrual", costs);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.incurredDateIso)).toEqual(["2026-01-15", "2026-01-20"]);
  });

  it("EXCLUDES unpaid costs on the cash basis rather than re-dating them", () => {
    const rows = costRowsForBasis("cash", costs);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountJmd).toBe(100);
    expect(rows[0].incurredDateIso).toBe("2026-02-15");
  });

  it("returns nothing on the cash basis when nothing has been paid", () => {
    expect(costRowsForBasis("cash", [cost({ paidDateIso: null })])).toEqual([]);
  });
});

describe("expenseDateForBasis", () => {
  it("picks the incurred date on accrual and the paid date on cash", () => {
    const e = expense({ incurredDateIso: "2026-01-01", paidDateIso: "2026-02-01" });
    expect(expenseDateForBasis("accrual", e)).toBe("2026-01-01");
    expect(expenseDateForBasis("cash", e)).toBe("2026-02-01");
  });

  it("returns null on the cash basis for an unpaid expense", () => {
    expect(expenseDateForBasis("cash", expense({ paidDateIso: null }))).toBeNull();
  });
});

describe("computeOperatingExpensesByMonth", () => {
  it("zero-fills every month in range when there is no data", () => {
    const rows = computeOperatingExpensesByMonth([], "accrual", RANGE, FX);
    expect(rows.map((r) => r.monthKey)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(rows.every((r) => r.totalJmd === 0 && r.byCategory.length === 0)).toBe(true);
  });

  it("groups by expense category within a month, largest first", () => {
    const rows = computeOperatingExpensesByMonth(
      [
        expense({ categoryName: "rent_utilities", categoryLabel: "Rent & Utilities", amountJmd: 100 }),
        expense({ categoryName: "software", categoryLabel: "Software", amountJmd: 500 }),
        expense({ categoryName: "rent_utilities", categoryLabel: "Rent & Utilities", amountJmd: 50 }),
      ],
      "accrual",
      RANGE,
      FX,
    );
    const jan = rows.find((r) => r.monthKey === "2026-01")!;
    expect(jan.totalJmd).toBe(650);
    expect(jan.byCategory.map((c) => [c.categoryLabel, c.amountJmd])).toEqual([
      ["Software", 500],
      ["Rent & Utilities", 150],
    ]);
  });

  it("category subtotals always reconcile to the month total", () => {
    const rows = computeOperatingExpensesByMonth(
      [expense({ amountJmd: 111 }), expense({ categoryName: "other", categoryLabel: "Other", amountJmd: 222 })],
      "accrual",
      RANGE,
      FX,
    );
    for (const row of rows) {
      expect(row.byCategory.reduce((s, c) => s + c.amountJmd, 0)).toBeCloseTo(row.totalJmd, 6);
    }
  });

  it("excludes unpaid expenses on the cash basis and buckets paid ones by payment month", () => {
    const expenses = [
      expense({ amountJmd: 100, incurredDateIso: "2026-01-01", paidDateIso: "2026-02-10" }),
      expense({ amountJmd: 900, incurredDateIso: "2026-01-02", paidDateIso: null }),
    ];
    const accrual = computeOperatingExpensesByMonth(expenses, "accrual", RANGE, FX);
    expect(accrual.find((r) => r.monthKey === "2026-01")!.totalJmd).toBe(1000);

    const cash = computeOperatingExpensesByMonth(expenses, "cash", RANGE, FX);
    expect(cash.find((r) => r.monthKey === "2026-01")!.totalJmd).toBe(0);
    expect(cash.find((r) => r.monthKey === "2026-02")!.totalJmd).toBe(100);
  });

  it("converts a USD-only expense at the CURRENT rate", () => {
    const rows = computeOperatingExpensesByMonth(
      [expense({ amountJmd: null, amountUsd: 100 })],
      "accrual",
      RANGE,
      FX,
    );
    expect(rows.find((r) => r.monthKey === "2026-01")!.totalJmd).toBeCloseTo(16686, 2);
  });

  it("reports an unconvertible USD-only expense separately instead of counting it as zero", () => {
    const rows = computeOperatingExpensesByMonth(
      [expense({ amountJmd: null, amountUsd: 100 })],
      "accrual",
      RANGE,
      NO_FX,
    );
    const jan = rows.find((r) => r.monthKey === "2026-01")!;
    expect(jan.totalJmd).toBe(0);
    expect(jan.unconvertedUsd).toBe(100);
    expect(jan.byCategory).toEqual([]);
  });

  it("excludes expenses outside the range", () => {
    const rows = computeOperatingExpensesByMonth(
      [expense({ incurredDateIso: "2025-06-01" })],
      "accrual",
      RANGE,
      FX,
    );
    expect(rows.reduce((s, r) => s + r.totalJmd, 0)).toBe(0);
  });

  it("merges per-month category subtotals into one period breakdown", () => {
    const rows = computeOperatingExpensesByMonth(
      [
        expense({ amountJmd: 100, incurredDateIso: "2026-01-05" }),
        expense({ amountJmd: 300, incurredDateIso: "2026-02-05" }),
        expense({
          categoryName: "software",
          categoryLabel: "Software",
          amountJmd: 50,
          incurredDateIso: "2026-02-06",
        }),
      ],
      "accrual",
      RANGE,
      FX,
    );
    expect(mergeOperatingExpenseCategories(rows).map((c) => [c.categoryName, c.amountJmd])).toEqual([
      ["rent_utilities", 400],
      ["software", 50],
    ]);
  });

  it("merges to nothing for empty rows", () => {
    expect(mergeOperatingExpenseCategories([])).toEqual([]);
  });
});

describe("buildIncomeStatement — arithmetic", () => {
  it("computes Revenue − COS = Gross, Gross − Opex = Net, with both margins", () => {
    const statement = buildIncomeStatement(
      inputs({
        issuedInvoices: [invoice({ revenueJmd: 1_000_000 })],
        costs: [cost({ amountJmd: 600_000 })],
        expenses: [expense({ amountJmd: 150_000 })],
      }),
      RANGE,
      "accrual",
    );
    const t = statement.total;
    expect(t.revenueJmd).toBe(1_000_000);
    expect(t.costOfSalesJmd).toBe(600_000);
    expect(t.grossProfitJmd).toBe(400_000);
    expect(t.grossMarginPct).toBeCloseTo(40, 6);
    expect(t.operatingExpensesJmd).toBe(150_000);
    expect(t.netProfitJmd).toBe(250_000);
    expect(t.netMarginPct).toBeCloseTo(25, 6);
  });

  it("produces a negative net profit when operating expenses exceed gross profit", () => {
    const statement = buildIncomeStatement(
      inputs({
        issuedInvoices: [invoice({ revenueJmd: 100_000 })],
        costs: [cost({ amountJmd: 80_000 })],
        expenses: [expense({ amountJmd: 50_000 })],
      }),
      RANGE,
      "accrual",
    );
    expect(statement.total.grossProfitJmd).toBe(20_000);
    expect(statement.total.netProfitJmd).toBe(-30_000);
    expect(statement.total.netMarginPct).toBeCloseTo(-30, 6);
  });

  it("leaves both margins null when there is no revenue (a margin on nothing is undefined, not 0%)", () => {
    const statement = buildIncomeStatement(
      inputs({ expenses: [expense({ amountJmd: 50_000 })] }),
      RANGE,
      "accrual",
    );
    expect(statement.total.revenueJmd).toBe(0);
    expect(statement.total.grossMarginPct).toBeNull();
    expect(statement.total.netMarginPct).toBeNull();
    expect(statement.total.netProfitJmd).toBe(-50_000);
  });

  it("returns a fully zeroed, zero-filled statement for completely empty data", () => {
    const statement = buildIncomeStatement(inputs(), RANGE, "accrual");
    expect(statement.months.map((m) => m.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(statement.months.every((m) => m.revenueJmd === 0 && m.netProfitJmd === 0)).toBe(true);
    expect(statement.total.netProfitJmd).toBe(0);
    expect(statement.costOfSalesByCategory).toEqual([]);
    expect(statement.operatingExpensesByCategory).toEqual([]);
    expect(statement.grossProfitByOrder).toEqual([]);
    expect(statement.usedCurrentRateConversion).toBe(false);
  });

  it("the monthly columns always sum to the period total", () => {
    const statement = buildIncomeStatement(
      inputs({
        issuedInvoices: [
          invoice({ revenueJmd: 500_000, issuedDateIso: "2026-01-10" }),
          invoice({ revenueJmd: 300_000, issuedDateIso: "2026-03-10", invoiceNumber: "VI-2026-002" }),
        ],
        costs: [
          cost({ amountJmd: 200_000, incurredDateIso: "2026-01-11" }),
          cost({ amountJmd: 100_000, incurredDateIso: "2026-02-11" }),
        ],
        expenses: [
          expense({ amountJmd: 40_000, incurredDateIso: "2026-01-01" }),
          expense({ amountJmd: 40_000, incurredDateIso: "2026-02-01" }),
          expense({ amountJmd: 40_000, incurredDateIso: "2026-03-01" }),
        ],
      }),
      RANGE,
      "accrual",
    );
    const sum = (pick: (c: (typeof statement.months)[number]) => number) =>
      statement.months.reduce((s, m) => s + pick(m), 0);
    expect(sum((m) => m.revenueJmd)).toBe(statement.total.revenueJmd);
    expect(sum((m) => m.costOfSalesJmd)).toBe(statement.total.costOfSalesJmd);
    expect(sum((m) => m.operatingExpensesJmd)).toBe(statement.total.operatingExpensesJmd);
    expect(sum((m) => m.netProfitJmd)).toBe(statement.total.netProfitJmd);
  });
});

describe("buildIncomeStatement — basis switching", () => {
  // One deal: invoiced 1,000,000 in January, but only 400,000 collected in
  // February. Cost of 600,000 incurred in January, paid in February. Rent of
  // 150,000 incurred and paid in January. Every figure below differs between
  // the two bases, and each is individually correct.
  const scenario = inputs({
    issuedInvoices: [invoice({ revenueJmd: 1_000_000, issuedDateIso: "2026-01-10" })],
    payments: [payment({ amountJmd: 400_000, paidAtIso: "2026-02-05" })],
    costs: [cost({ amountJmd: 600_000, incurredDateIso: "2026-01-15", paidDateIso: "2026-02-15" })],
    expenses: [expense({ amountJmd: 150_000, incurredDateIso: "2026-01-01", paidDateIso: "2026-01-05" })],
  });

  it("accrual: revenue is the invoice, costs sit in the month incurred", () => {
    const s = buildIncomeStatement(scenario, RANGE, "accrual");
    expect(s.basis).toBe("accrual");
    expect(s.total.revenueJmd).toBe(1_000_000);
    expect(s.total.costOfSalesJmd).toBe(600_000);
    expect(s.total.operatingExpensesJmd).toBe(150_000);
    expect(s.total.netProfitJmd).toBe(250_000);

    const jan = s.months.find((m) => m.key === "2026-01")!;
    expect(jan.revenueJmd).toBe(1_000_000);
    expect(jan.costOfSalesJmd).toBe(600_000);
    expect(jan.operatingExpensesJmd).toBe(150_000);

    const feb = s.months.find((m) => m.key === "2026-02")!;
    expect(feb.revenueJmd).toBe(0);
    expect(feb.costOfSalesJmd).toBe(0);
  });

  it("cash: revenue is the payment, costs sit in the month paid", () => {
    const s = buildIncomeStatement(scenario, RANGE, "cash");
    expect(s.basis).toBe("cash");
    expect(s.total.revenueJmd).toBe(400_000);
    expect(s.total.costOfSalesJmd).toBe(600_000);
    expect(s.total.operatingExpensesJmd).toBe(150_000);
    expect(s.total.netProfitJmd).toBe(-350_000);

    const jan = s.months.find((m) => m.key === "2026-01")!;
    expect(jan.revenueJmd).toBe(0);
    expect(jan.costOfSalesJmd).toBe(0);
    expect(jan.operatingExpensesJmd).toBe(150_000);

    const feb = s.months.find((m) => m.key === "2026-02")!;
    expect(feb.revenueJmd).toBe(400_000);
    expect(feb.costOfSalesJmd).toBe(600_000);
  });

  it("the two bases produce genuinely different, individually correct totals", () => {
    const accrual = buildIncomeStatement(scenario, RANGE, "accrual");
    const cash = buildIncomeStatement(scenario, RANGE, "cash");
    expect(accrual.total.revenueJmd).not.toBe(cash.total.revenueJmd);
    expect(accrual.total.netProfitJmd).not.toBe(cash.total.netProfitJmd);
  });

  it("cash basis drops unpaid costs and expenses entirely", () => {
    const unpaid = inputs({
      payments: [payment({ amountJmd: 500_000, paidAtIso: "2026-01-05" })],
      issuedInvoices: [invoice({ revenueJmd: 500_000 })],
      costs: [cost({ amountJmd: 300_000, paidDateIso: null })],
      expenses: [expense({ amountJmd: 100_000, paidDateIso: null })],
    });
    const accrual = buildIncomeStatement(unpaid, RANGE, "accrual");
    expect(accrual.total.costOfSalesJmd).toBe(300_000);
    expect(accrual.total.operatingExpensesJmd).toBe(100_000);

    const cash = buildIncomeStatement(unpaid, RANGE, "cash");
    expect(cash.total.costOfSalesJmd).toBe(0);
    expect(cash.total.operatingExpensesJmd).toBe(0);
    expect(cash.total.netProfitJmd).toBe(500_000);
  });
});

describe("buildIncomeStatement — multi-currency", () => {
  it("converts an order-linked USD cost at the ORDER's locked rate and a USD expense at the CURRENT rate", () => {
    const s = buildIncomeStatement(
      inputs({
        issuedInvoices: [invoice({ revenueJmd: 1_000_000 })],
        costs: [cost({ amountJmd: null, amountUsd: 1000 })],
        expenses: [expense({ amountJmd: null, amountUsd: 100 })],
        rateByOrderId: { o1: 200 }, // deliberately different from the current rate
        fx: buildCurrentFxRate(100, 0),
      }),
      RANGE,
      "accrual",
    );
    expect(s.total.costOfSalesJmd).toBeCloseTo(200_000, 2); // 1000 x 200 (order-locked)
    expect(s.total.operatingExpensesJmd).toBeCloseTo(10_000, 2); // 100 x 100 (current)
    expect(s.usedCurrentRateConversion).toBe(true);
  });

  it("never re-derives a JMD figure from a USD sibling on the same row (no double counting)", () => {
    const s = buildIncomeStatement(
      inputs({
        costs: [cost({ amountJmd: 5_000, amountUsd: 999 })],
        expenses: [expense({ amountJmd: 1_000, amountUsd: 999 })],
      }),
      RANGE,
      "accrual",
    );
    expect(s.total.costOfSalesJmd).toBe(5_000);
    expect(s.total.operatingExpensesJmd).toBe(1_000);
  });

  it("surfaces unconvertible amounts on both lines rather than absorbing them", () => {
    const s = buildIncomeStatement(
      inputs({
        costs: [cost({ orderId: "unknown", amountJmd: null, amountUsd: 500 })],
        expenses: [expense({ amountJmd: null, amountUsd: 200 })],
        fx: NO_FX,
      }),
      RANGE,
      "accrual",
    );
    expect(s.total.costOfSalesJmd).toBe(0);
    expect(s.total.operatingExpensesJmd).toBe(0);
    expect(s.unconvertedCostOfSalesUsd).toBe(500);
    expect(s.unconvertedOperatingExpensesUsd).toBe(200);
  });

  it("does not claim a live-rate conversion when every expense was recorded in JMD", () => {
    const s = buildIncomeStatement(inputs({ expenses: [expense({ amountJmd: 1_000 })] }), RANGE, "accrual");
    expect(s.usedCurrentRateConversion).toBe(false);
  });

  it("does not claim a live-rate conversion for a USD expense the basis excludes", () => {
    const s = buildIncomeStatement(
      inputs({ expenses: [expense({ amountJmd: null, amountUsd: 100, paidDateIso: null })] }),
      RANGE,
      "cash",
    );
    expect(s.usedCurrentRateConversion).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MAJOR M-1 — GCT is a liability, never revenue.
// ---------------------------------------------------------------------------

describe("invoiceRevenueShare", () => {
  it("returns the subtotal's share of the gross for a GCT-bearing invoice", () => {
    expect(invoiceRevenueShare(100, 115)).toBeCloseTo(100 / 115, 12);
  });

  it("returns 1 for a GCT-free invoice (subtotal == gross)", () => {
    expect(invoiceRevenueShare(500, 500)).toBe(1);
  });

  it("treats the payment as fully revenue when the gross is 0, null or absent (no divide-by-zero)", () => {
    expect(invoiceRevenueShare(100, 0)).toBe(1);
    expect(invoiceRevenueShare(100, null)).toBe(1);
    expect(invoiceRevenueShare(100, undefined)).toBe(1);
    expect(Number.isFinite(invoiceRevenueShare(100, 0))).toBe(true);
  });

  it("treats the payment as fully revenue when no subtotal was recorded", () => {
    expect(invoiceRevenueShare(null, 115)).toBe(1);
    expect(invoiceRevenueShare(undefined, 115)).toBe(1);
  });
});

describe("gctCollectedJmd", () => {
  it("is zero on both bases while GCT is disabled", () => {
    const invoices = [invoice({ revenueJmd: 1_000_000 })];
    const payments = [payment({ amountJmd: 400_000 })];
    expect(gctCollectedJmd("accrual", invoices, payments, RANGE)).toBe(0);
    expect(gctCollectedJmd("cash", invoices, payments, RANGE)).toBe(0);
  });

  it("counts GCT billed on the accrual basis and GCT received on the cash basis", () => {
    const invoices = [invoiceWithGct(1_000_000)]; // 150,000 GCT billed
    const payments = [paymentWithGct(115_000)]; // 15,000 GCT received
    expect(gctCollectedJmd("accrual", invoices, payments, RANGE)).toBeCloseTo(150_000, 2);
    expect(gctCollectedJmd("cash", invoices, payments, RANGE)).toBeCloseTo(15_000, 2);
  });

  it("ignores rows outside the range on each basis", () => {
    expect(gctCollectedJmd("accrual", [invoiceWithGct(1_000_000, { issuedDateIso: "2025-12-31" })], [], RANGE)).toBe(0);
    expect(gctCollectedJmd("cash", [], [paymentWithGct(115_000, { paidAtIso: "2026-04-01" })], RANGE)).toBe(0);
  });
});

describe("buildIncomeStatement — GCT is excluded from revenue (MAJOR M-1)", () => {
  it("ACCRUAL: revenue is the GCT-EXCLUSIVE subtotal, not the invoice's gross amount", () => {
    const s = buildIncomeStatement(
      // Billed J$1,150,000 = 1,000,000 net + 150,000 GCT.
      inputs({ issuedInvoices: [invoiceWithGct(1_000_000)] }),
      RANGE,
      "accrual",
    );
    expect(s.total.revenueJmd).toBe(1_000_000);
    expect(s.total.revenueJmd).not.toBe(1_150_000);
    expect(s.gctCollectedJmd).toBeCloseTo(150_000, 2);
  });

  it("CASH: a payment is pro-rated, so only its net share is revenue", () => {
    // J$575,000 received against a 15%-GCT invoice = half the gross of
    // 1,150,000 → 500,000 revenue, 75,000 GCT.
    const s = buildIncomeStatement(inputs({ payments: [paymentWithGct(575_000)] }), RANGE, "cash");
    expect(s.total.revenueJmd).toBeCloseTo(500_000, 2);
    expect(s.gctCollectedJmd).toBeCloseTo(75_000, 2);
  });

  it("GCT never touches gross profit, net profit or either margin", () => {
    const s = buildIncomeStatement(
      inputs({ issuedInvoices: [invoiceWithGct(1_000_000)], costs: [cost({ amountJmd: 600_000 })] }),
      RANGE,
      "accrual",
    );
    // 1,000,000 − 600,000, NOT 1,150,000 − 600,000.
    expect(s.total.grossProfitJmd).toBe(400_000);
    expect(s.total.grossMarginPct).toBeCloseTo(40, 6);
    expect(s.total.netProfitJmd).toBe(400_000);
  });

  it("WITH GCT OFF (today's live configuration) both bases are unchanged", () => {
    const scenario = inputs({
      issuedInvoices: [invoice({ revenueJmd: 1_000_000 })],
      payments: [payment({ amountJmd: 400_000 })],
    });
    const accrual = buildIncomeStatement(scenario, RANGE, "accrual");
    const cash = buildIncomeStatement(scenario, RANGE, "cash");
    expect(accrual.total.revenueJmd).toBe(1_000_000);
    expect(cash.total.revenueJmd).toBe(400_000);
    expect(accrual.gctCollectedJmd).toBe(0);
    expect(cash.gctCollectedJmd).toBe(0);
  });

  it("turning GCT ON changes revenue by exactly the GCT, on both bases", () => {
    const withoutAccrual = buildIncomeStatement(
      inputs({ issuedInvoices: [invoice({ revenueJmd: 1_000_000 })] }),
      RANGE,
      "accrual",
    );
    const withAccrual = buildIncomeStatement(
      inputs({ issuedInvoices: [invoiceWithGct(1_000_000)] }),
      RANGE,
      "accrual",
    );
    // The whole point: the GROSS grew by 15%, the REVENUE did not move.
    expect(withAccrual.total.revenueJmd).toBe(withoutAccrual.total.revenueJmd);

    const withoutCash = buildIncomeStatement(inputs({ payments: [payment({ amountJmd: 115_000 })] }), RANGE, "cash");
    const withCash = buildIncomeStatement(inputs({ payments: [paymentWithGct(115_000)] }), RANGE, "cash");
    expect(withoutCash.total.revenueJmd).toBe(115_000);
    expect(withCash.total.revenueJmd).toBeCloseTo(100_000, 2);
    expect(withCash.gctCollectedJmd).toBeCloseTo(15_000, 2);
  });

  it("the per-order view is GCT-exclusive too, on both bases", () => {
    const scenario = inputs({
      issuedInvoices: [invoiceWithGct(1_000_000)],
      payments: [paymentWithGct(575_000)],
    });
    expect(buildIncomeStatement(scenario, RANGE, "accrual").grossProfitByOrder[0].revenueJmd).toBe(1_000_000);
    expect(buildIncomeStatement(scenario, RANGE, "cash").grossProfitByOrder[0].revenueJmd).toBeCloseTo(500_000, 2);
  });
});

describe("buildIncomeStatement — per-order view", () => {
  it("reports GROSS profit per order and never subtracts operating expenses from it", () => {
    const s = buildIncomeStatement(
      inputs({
        issuedInvoices: [invoice({ revenueJmd: 1_000_000 })],
        costs: [cost({ amountJmd: 600_000 })],
        expenses: [expense({ amountJmd: 150_000 })],
      }),
      RANGE,
      "accrual",
    );
    expect(s.grossProfitByOrder).toHaveLength(1);
    const order = s.grossProfitByOrder[0];
    expect(order.revenueJmd).toBe(1_000_000);
    expect(order.costJmd).toBe(600_000);
    // 400,000 — NOT 250,000. Opex is deliberately unallocated.
    expect(order.grossProfitJmd).toBe(400_000);
    expect(order.grossProfitJmd).not.toBe(s.total.netProfitJmd);
  });

  it("shows an order with in-range costs but no in-range revenue (MAJOR M-2)", () => {
    const s = buildIncomeStatement(
      inputs({
        // VQ-2026-001's invoice is in range; VQ-LATE's is not, but its costs are.
        issuedInvoices: [invoice({ revenueJmd: 1_000_000 })],
        costs: [
          cost({ amountJmd: 600_000 }),
          cost({ orderId: "o9", quoteRef: "VQ-LATE", amountJmd: 250_000, incurredDateIso: "2026-02-01" }),
        ],
      }),
      RANGE,
      "accrual",
    );
    const late = s.grossProfitByOrder.find((r) => r.quoteRef === "VQ-LATE");
    expect(late).toBeDefined();
    expect(late!.revenueJmd).toBe(0);
    expect(late!.costJmd).toBe(250_000);
    expect(late!.grossProfitJmd).toBe(-250_000);
  });

  it("the per-order cost column reconciles to the statement's Cost of sales line (MAJOR M-2)", () => {
    for (const basis of ["accrual", "cash"] as const) {
      const s = buildIncomeStatement(
        inputs({
          issuedInvoices: [invoice({ revenueJmd: 1_000_000 })],
          payments: [payment({ amountJmd: 400_000 })],
          costs: [
            cost({ amountJmd: 600_000, incurredDateIso: "2026-01-15", paidDateIso: "2026-02-15" }),
            cost({
              orderId: "o9",
              quoteRef: "VQ-LATE",
              amountJmd: 250_000,
              incurredDateIso: "2026-02-01",
              paidDateIso: "2026-02-20",
            }),
          ],
        }),
        RANGE,
        basis,
      );
      expect(s.grossProfitByOrder.reduce((sum, r) => sum + r.costJmd, 0)).toBeCloseTo(s.total.costOfSalesJmd, 6);
      expect(s.total.costOfSalesJmd).toBe(850_000);
    }
  });

  it("follows the basis, like every other figure", () => {
    const scenario = inputs({
      issuedInvoices: [invoice({ revenueJmd: 1_000_000 })],
      payments: [payment({ amountJmd: 400_000 })],
      costs: [cost({ amountJmd: 600_000, incurredDateIso: "2026-01-15", paidDateIso: "2026-02-15" })],
    });
    expect(buildIncomeStatement(scenario, RANGE, "accrual").grossProfitByOrder[0].revenueJmd).toBe(1_000_000);
    expect(buildIncomeStatement(scenario, RANGE, "cash").grossProfitByOrder[0].revenueJmd).toBe(400_000);
  });
});

describe("buildIncomeStatement — category breakdowns", () => {
  it("breaks cost of sales out by actual-cost category, largest first", () => {
    const s = buildIncomeStatement(
      inputs({
        costs: [
          cost({ category: "hardware", amountJmd: 100 }),
          cost({ category: "freight", amountJmd: 500 }),
          cost({ category: "hardware", amountJmd: 50 }),
        ],
      }),
      RANGE,
      "accrual",
    );
    expect(s.costOfSalesByCategory).toEqual([
      ["freight", 500],
      ["hardware", 150],
    ]);
  });

  it("breaks operating expenses out by expense category, largest first", () => {
    const s = buildIncomeStatement(
      inputs({
        expenses: [
          expense({ categoryName: "rent_utilities", categoryLabel: "Rent & Utilities", amountJmd: 100 }),
          expense({ categoryName: "salaries_wages", categoryLabel: "Salaries & Wages", amountJmd: 900 }),
        ],
      }),
      RANGE,
      "accrual",
    );
    expect(s.operatingExpensesByCategory.map((c) => c.categoryName)).toEqual([
      "salaries_wages",
      "rent_utilities",
    ]);
  });

  it("each breakdown reconciles to its own statement line", () => {
    const s = buildIncomeStatement(
      inputs({
        costs: [cost({ category: "duty", amountJmd: 111 }), cost({ category: "freight", amountJmd: 222 })],
        expenses: [
          expense({ amountJmd: 333 }),
          expense({ categoryName: "other", categoryLabel: "Other", amountJmd: 444 }),
        ],
      }),
      RANGE,
      "accrual",
    );
    expect(s.costOfSalesByCategory.reduce((sum, [, v]) => sum + v, 0)).toBeCloseTo(s.total.costOfSalesJmd, 6);
    expect(s.operatingExpensesByCategory.reduce((sum, c) => sum + c.amountJmd, 0)).toBeCloseTo(
      s.total.operatingExpensesJmd,
      6,
    );
  });
});

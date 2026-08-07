import { describe, expect, it } from "vitest";
import { buildCurrentFxRate } from "../expenses/expense";
import type { ReportBasis } from "./basis";
import {
  buildIncomeStatement,
  invoiceRevenueShare,
  roundJmd,
  type IncomeStatementInputs,
} from "./incomeStatement";
import type { ReportDateRange } from "./period";
import {
  buildTransactionLedger,
  parseTransactionTypes,
  TRANSACTION_DIRECTION,
  transactionTypesForBasis,
  type LedgerCostInput,
  type LedgerExpenseInput,
  type LedgerInvoiceInput,
  type LedgerPaymentInput,
  type TransactionLedgerInputs,
} from "./transactions";

const RANGE: ReportDateRange = { startIso: "2026-01-01", endIso: "2026-03-31" };
const ORDER_RATES = { o1: 200 };
const FX = buildCurrentFxRate(100, 0); // current rate, deliberately != the order rate
const NO_FX = buildCurrentFxRate(null, null);
const BASES: ReportBasis[] = ["accrual", "cash"];

/** An issued invoice with no GCT — today's live shape (`gct_enabled` is false). */
function invoice(overrides: Partial<LedgerInvoiceInput> = {}): LedgerInvoiceInput {
  const revenueJmd = overrides.revenueJmd ?? 1_000_000;
  return {
    grossAmountJmd: revenueJmd,
    revenueJmd,
    gctJmd: 0,
    issuedDateIso: "2026-01-10",
    orderId: "o1",
    quoteRef: "VQ-2026-001",
    invoiceNumber: "VI-2026-001",
    companyName: "Sandals Resorts",
    ...overrides,
  };
}

/** The same invoice raised with 15% GCT: gross = subtotal x 1.15. */
function invoiceWithGct(subtotalJmd: number, overrides: Partial<LedgerInvoiceInput> = {}): LedgerInvoiceInput {
  const gctJmd = roundJmd(subtotalJmd * 0.15);
  return invoice({
    grossAmountJmd: roundJmd(subtotalJmd + gctJmd),
    revenueJmd: subtotalJmd,
    gctJmd,
    ...overrides,
  });
}

function payment(overrides: Partial<LedgerPaymentInput> = {}): LedgerPaymentInput {
  const amountJmd = overrides.amountJmd ?? 400_000;
  return {
    amountJmd,
    revenueJmd: amountJmd,
    gctJmd: 0,
    paidAtIso: "2026-02-05",
    orderId: "o1",
    quoteRef: "VQ-2026-001",
    invoiceNumber: "VI-2026-001",
    companyName: "Sandals Resorts",
    method: "Wire",
    reference: "TRX-9911",
    ...overrides,
  };
}

/** A payment against a 15%-GCT invoice, pro-rated the way lib/reports/load.ts does. */
function paymentWithGct(amountJmd: number, overrides: Partial<LedgerPaymentInput> = {}): LedgerPaymentInput {
  const revenueJmd = roundJmd(amountJmd * invoiceRevenueShare(100, 115));
  return payment({ amountJmd, revenueJmd, gctJmd: roundJmd(amountJmd - revenueJmd), ...overrides });
}

function cost(overrides: Partial<LedgerCostInput> = {}): LedgerCostInput {
  return {
    orderId: "o1",
    category: "freight",
    amountUsd: null,
    amountJmd: 90_000,
    incurredDateIso: "2026-01-15",
    paidDateIso: "2026-02-15",
    description: "Ocean freight, Miami–Kingston",
    supplierName: "Seaboard",
    quoteRef: "VQ-2026-001",
    companyName: "Sandals Resorts",
    ...overrides,
  };
}

function expense(overrides: Partial<LedgerExpenseInput> = {}): LedgerExpenseInput {
  return {
    categoryName: "rent_utilities",
    categoryLabel: "Rent & Utilities",
    amountJmd: 150_000,
    amountUsd: null,
    incurredDateIso: "2026-01-01",
    paidDateIso: "2026-01-05",
    description: "Office rent — January",
    vendor: "Kingston Properties",
    reference: "INV-4410",
    ...overrides,
  };
}

function inputs(overrides: Partial<TransactionLedgerInputs> = {}): TransactionLedgerInputs {
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

/**
 * The ledger's inputs are a superset of the income statement's, so one
 * scenario can be fed to both — which is exactly what the reconciliation
 * tests below need.
 */
function asStatementInputs(i: TransactionLedgerInputs): IncomeStatementInputs {
  return {
    issuedInvoices: i.issuedInvoices,
    payments: i.payments,
    costs: i.costs,
    expenses: i.expenses,
    rateByOrderId: i.rateByOrderId,
    fx: i.fx,
  };
}

describe("parseTransactionTypes", () => {
  it("returns an empty list (meaning 'all') for nothing", () => {
    expect(parseTransactionTypes(undefined)).toEqual([]);
    expect(parseTransactionTypes(null)).toEqual([]);
    expect(parseTransactionTypes([])).toEqual([]);
  });

  it("accepts a single value, a repeated param, and a comma-joined string", () => {
    expect(parseTransactionTypes("operating_expense")).toEqual(["operating_expense"]);
    expect(parseTransactionTypes(["customer_payment", "cost_of_sales"])).toEqual([
      "customer_payment",
      "cost_of_sales",
    ]);
    expect(parseTransactionTypes("invoice_issued,operating_expense")).toEqual([
      "invoice_issued",
      "operating_expense",
    ]);
  });

  it("drops unknown values instead of erroring, and de-duplicates", () => {
    expect(parseTransactionTypes(["bogus", "cost_of_sales", "cost_of_sales"])).toEqual(["cost_of_sales"]);
  });
});

describe("transactionTypesForBasis", () => {
  it("offers the issued-invoice revenue type on accrual and the payment type on cash", () => {
    expect(transactionTypesForBasis("accrual")).toEqual([
      "invoice_issued",
      "cost_of_sales",
      "operating_expense",
    ]);
    expect(transactionTypesForBasis("cash")).toEqual([
      "customer_payment",
      "cost_of_sales",
      "operating_expense",
    ]);
  });

  it("never offers both revenue types at once — they would double-count", () => {
    for (const basis of BASES) {
      const types = transactionTypesForBasis(basis);
      expect(types.includes("invoice_issued") && types.includes("customer_payment")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// BLOCKER B-1 — the ledger is basis-aware and dates every row consistently.
// ---------------------------------------------------------------------------

describe("buildTransactionLedger — basis selects the revenue source", () => {
  const both = inputs({ issuedInvoices: [invoice()], payments: [payment()] });

  it("ACCRUAL lists the issued invoice and NOT the payment", () => {
    const ledger = buildTransactionLedger(both, RANGE, "accrual");
    expect(ledger.rows.map((r) => r.type)).toEqual(["invoice_issued"]);
    expect(ledger.rows[0].dateIso).toBe("2026-01-10");
    expect(ledger.totalInJmd).toBe(1_000_000);
  });

  it("CASH lists the payment and NOT the issued invoice", () => {
    const ledger = buildTransactionLedger(both, RANGE, "cash");
    expect(ledger.rows.map((r) => r.type)).toEqual(["customer_payment"]);
    expect(ledger.rows[0].dateIso).toBe("2026-02-05");
    expect(ledger.totalInJmd).toBe(400_000);
  });

  it("never lists both — one deal is one revenue event per basis", () => {
    for (const basis of BASES) {
      const ledger = buildTransactionLedger(both, RANGE, basis);
      expect(ledger.rows.filter((r) => TRANSACTION_DIRECTION[r.type] === 1)).toHaveLength(1);
    }
  });

  it("reports the basis it was built on", () => {
    expect(buildTransactionLedger(inputs(), RANGE, "accrual").basis).toBe("accrual");
    expect(buildTransactionLedger(inputs(), RANGE, "cash").basis).toBe("cash");
  });

  it("gives the accrual Revenue line row-level support, which it previously had none of", () => {
    const ledger = buildTransactionLedger(inputs({ issuedInvoices: [invoice()] }), RANGE, "accrual");
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({
      type: "invoice_issued",
      reference: "VI-2026-001",
      party: "Sandals Resorts",
      description: "Invoice issued against VQ-2026-001",
      incurredDateIso: "2026-01-10",
      paidDateIso: null,
    });
  });
});

describe("buildTransactionLedger — basis dates costs and expenses", () => {
  const scenario = inputs({
    costs: [cost({ incurredDateIso: "2026-01-15", paidDateIso: "2026-03-20" })],
    expenses: [expense({ incurredDateIso: "2026-01-02", paidDateIso: "2026-03-25" })],
  });

  it("ACCRUAL places both at their incurred date", () => {
    const ledger = buildTransactionLedger(scenario, RANGE, "accrual");
    expect(ledger.rows.map((r) => r.dateIso)).toEqual(["2026-01-02", "2026-01-15"]);
  });

  it("CASH places both at their paid date", () => {
    const ledger = buildTransactionLedger(scenario, RANGE, "cash");
    expect(ledger.rows.map((r) => r.dateIso)).toEqual(["2026-03-20", "2026-03-25"]);
  });

  it("CASH drops an unpaid cost or expense entirely rather than re-dating it", () => {
    const unpaid = inputs({
      costs: [cost({ paidDateIso: null })],
      expenses: [expense({ paidDateIso: null })],
    });
    expect(buildTransactionLedger(unpaid, RANGE, "cash").rows).toEqual([]);
    expect(buildTransactionLedger(unpaid, RANGE, "cash").totalOutJmd).toBe(0);
  });

  it("ACCRUAL keeps an unpaid row visible, with a null paid date", () => {
    const ledger = buildTransactionLedger(inputs({ expenses: [expense({ paidDateIso: null })] }), RANGE, "accrual");
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].paidDateIso).toBeNull();
    expect(ledger.totalOutJmd).toBe(150_000);
  });

  it("a cost paid inside the range but incurred before it appears only on the cash basis", () => {
    const straddling = inputs({
      costs: [cost({ amountJmd: 42_000, incurredDateIso: "2025-12-20", paidDateIso: "2026-01-20" })],
    });
    expect(buildTransactionLedger(straddling, RANGE, "accrual").rows).toEqual([]);
    expect(buildTransactionLedger(straddling, RANGE, "cash").totalOutJmd).toBe(42_000);
  });
});

// ---------------------------------------------------------------------------
// THE POINT OF THE WHOLE REPORT: it ties out to the income statement.
// ---------------------------------------------------------------------------

describe("buildTransactionLedger — reconciliation to the income statement (BLOCKER B-1)", () => {
  /**
   * One realistic period, deliberately built so EVERY figure differs between
   * the two bases: an invoice issued in January but only part-collected in
   * February; a cost incurred in January and paid in February; a second
   * order whose costs land in range but whose invoice does not; rent paid the
   * month it was incurred; and an unpaid bill that exists on accrual only.
   */
  const scenario = inputs({
    issuedInvoices: [invoice({ revenueJmd: 1_000_000, issuedDateIso: "2026-01-10" })],
    payments: [payment({ amountJmd: 400_000, paidAtIso: "2026-02-05" })],
    costs: [
      cost({ amountJmd: 600_000, incurredDateIso: "2026-01-15", paidDateIso: "2026-02-15" }),
      cost({
        orderId: "o9",
        quoteRef: "VQ-LATE",
        amountJmd: 250_000,
        incurredDateIso: "2026-02-01",
        paidDateIso: "2026-02-20",
      }),
      cost({ amountJmd: 33_000, incurredDateIso: "2026-03-01", paidDateIso: null }),
    ],
    expenses: [
      expense({ amountJmd: 150_000, incurredDateIso: "2026-01-01", paidDateIso: "2026-01-05" }),
      expense({ amountJmd: 90_000, incurredDateIso: "2026-02-01", paidDateIso: null }),
    ],
  });

  for (const basis of BASES) {
    it(`${basis}: Money in / Money out / Net EQUAL the statement's Revenue / (COS + Opex) / Net profit`, () => {
      const ledger = buildTransactionLedger(scenario, RANGE, basis);
      const statement = buildIncomeStatement(asStatementInputs(scenario), RANGE, basis);

      expect(ledger.totalInJmd).toBeCloseTo(statement.total.revenueJmd, 6);
      expect(ledger.totalOutJmd).toBeCloseTo(
        statement.total.costOfSalesJmd + statement.total.operatingExpensesJmd,
        6,
      );
      expect(ledger.netJmd).toBeCloseTo(statement.total.netProfitJmd, 6);
      expect(ledger.gctCollectedJmd).toBeCloseTo(statement.gctCollectedJmd, 6);
    });
  }

  it("the two bases genuinely disagree — the reconciliation is not trivially true", () => {
    const accrual = buildTransactionLedger(scenario, RANGE, "accrual");
    const cash = buildTransactionLedger(scenario, RANGE, "cash");
    expect(accrual.totalInJmd).not.toBe(cash.totalInJmd);
    expect(accrual.totalOutJmd).not.toBe(cash.totalOutJmd);
    expect(accrual.netJmd).not.toBe(cash.netJmd);
  });

  it("reconciles with GCT switched ON, on both bases", () => {
    const withGct = inputs({
      issuedInvoices: [invoiceWithGct(1_000_000, { issuedDateIso: "2026-01-10" })],
      payments: [paymentWithGct(575_000, { paidAtIso: "2026-02-05" })],
      costs: [cost({ amountJmd: 600_000, incurredDateIso: "2026-01-15", paidDateIso: "2026-02-15" })],
      expenses: [expense({ amountJmd: 150_000 })],
    });
    for (const basis of BASES) {
      const ledger = buildTransactionLedger(withGct, RANGE, basis);
      const statement = buildIncomeStatement(asStatementInputs(withGct), RANGE, basis);
      expect(ledger.totalInJmd).toBeCloseTo(statement.total.revenueJmd, 6);
      expect(ledger.netJmd).toBeCloseTo(statement.total.netProfitJmd, 6);
      expect(ledger.gctCollectedJmd).toBeCloseTo(statement.gctCollectedJmd, 6);
      expect(ledger.gctCollectedJmd).toBeGreaterThan(0);
    }
  });

  it("reconciles with USD rows converting at two different rates", () => {
    const multiCurrency = inputs({
      issuedInvoices: [invoice({ revenueJmd: 500_000 })],
      payments: [payment({ amountJmd: 500_000, paidAtIso: "2026-01-20" })],
      // Converts at the ORDER's locked 200; the expense at the CURRENT 100.
      costs: [cost({ amountJmd: null, amountUsd: 1_000, incurredDateIso: "2026-01-15", paidDateIso: "2026-01-16" })],
      expenses: [
        expense({ amountJmd: null, amountUsd: 300, incurredDateIso: "2026-01-01", paidDateIso: "2026-01-02" }),
      ],
    });
    for (const basis of BASES) {
      const ledger = buildTransactionLedger(multiCurrency, RANGE, basis);
      const statement = buildIncomeStatement(asStatementInputs(multiCurrency), RANGE, basis);
      expect(ledger.totalOutJmd).toBeCloseTo(
        statement.total.costOfSalesJmd + statement.total.operatingExpensesJmd,
        6,
      );
      expect(ledger.totalOutJmd).toBeCloseTo(200_000 + 30_000, 2);
    }
  });

  it("both reports exclude the SAME unconvertible rows, so they still tie out", () => {
    const unconvertible = inputs({
      issuedInvoices: [invoice({ revenueJmd: 100_000 })],
      payments: [payment({ amountJmd: 100_000, paidAtIso: "2026-01-20" })],
      costs: [
        cost({ orderId: "unknown", amountJmd: null, amountUsd: 500, paidDateIso: "2026-01-16" }),
      ],
      expenses: [expense({ amountJmd: null, amountUsd: 200, paidDateIso: "2026-01-05" })],
      fx: NO_FX,
    });
    for (const basis of BASES) {
      const ledger = buildTransactionLedger(unconvertible, RANGE, basis);
      const statement = buildIncomeStatement(asStatementInputs(unconvertible), RANGE, basis);
      expect(ledger.totalOutJmd).toBe(0);
      expect(ledger.totalOutJmd).toBe(statement.total.costOfSalesJmd + statement.total.operatingExpensesJmd);
      expect(ledger.unresolvedUsd).toBe(700);
      expect(statement.unconvertedCostOfSalesUsd + statement.unconvertedOperatingExpensesUsd).toBe(700);
    }
  });

  it("reconciles when the ONLY activity is an out-of-period-revenue order's costs", () => {
    const costsOnly = inputs({
      costs: [cost({ orderId: "o9", quoteRef: "VQ-LATE", amountJmd: 250_000, paidDateIso: "2026-02-20" })],
    });
    for (const basis of BASES) {
      const ledger = buildTransactionLedger(costsOnly, RANGE, basis);
      const statement = buildIncomeStatement(asStatementInputs(costsOnly), RANGE, basis);
      expect(ledger.totalInJmd).toBe(0);
      expect(ledger.totalOutJmd).toBe(250_000);
      expect(ledger.netJmd).toBeCloseTo(statement.total.netProfitJmd, 6);
    }
  });

  it("reconciles on empty data", () => {
    for (const basis of BASES) {
      const ledger = buildTransactionLedger(inputs(), RANGE, basis);
      const statement = buildIncomeStatement(asStatementInputs(inputs()), RANGE, basis);
      expect(ledger.totalInJmd).toBe(statement.total.revenueJmd);
      expect(ledger.netJmd).toBe(statement.total.netProfitJmd);
    }
  });
});

// ---------------------------------------------------------------------------

describe("buildTransactionLedger — GCT on revenue rows (MAJOR M-1)", () => {
  it("totals the GCT-EXCLUSIVE amount while showing the gross as recorded (accrual)", () => {
    const ledger = buildTransactionLedger(
      inputs({ issuedInvoices: [invoiceWithGct(1_000_000)] }),
      RANGE,
      "accrual",
    );
    expect(ledger.rows[0]).toMatchObject({
      amountJmd: 1_150_000, // as recorded, GCT included
      resolvedJmd: 1_000_000, // what the Revenue line sums
      gctJmd: 150_000,
    });
    expect(ledger.totalInJmd).toBe(1_000_000);
    expect(ledger.gctCollectedJmd).toBe(150_000);
  });

  it("pro-rates a part payment into its revenue and GCT shares (cash)", () => {
    const ledger = buildTransactionLedger(inputs({ payments: [paymentWithGct(575_000)] }), RANGE, "cash");
    expect(ledger.totalInJmd).toBeCloseTo(500_000, 2);
    expect(ledger.gctCollectedJmd).toBeCloseTo(75_000, 2);
    // as-recorded = for-totalling + GCT, on every revenue row.
    const r = ledger.rows[0];
    expect(r.amountJmd).toBeCloseTo((r.resolvedJmd ?? 0) + r.gctJmd, 6);
  });

  it("leaves every money-out row's GCT at zero", () => {
    const ledger = buildTransactionLedger(
      inputs({ costs: [cost()], expenses: [expense()] }),
      RANGE,
      "accrual",
    );
    expect(ledger.rows.every((r) => r.gctJmd === 0)).toBe(true);
    expect(ledger.gctCollectedJmd).toBe(0);
  });

  it("is a no-op while GCT is disabled — gross equals net on every revenue row", () => {
    for (const basis of BASES) {
      const ledger = buildTransactionLedger(
        inputs({ issuedInvoices: [invoice()], payments: [payment()] }),
        RANGE,
        basis,
      );
      expect(ledger.rows.every((r) => r.gctJmd === 0 && r.amountJmd === r.resolvedJmd)).toBe(true);
    }
  });
});

describe("buildTransactionLedger — merge and ordering", () => {
  it("merges every source the basis produces into one chronological listing", () => {
    const ledger = buildTransactionLedger(
      inputs({ issuedInvoices: [invoice()], costs: [cost()], expenses: [expense()] }),
      RANGE,
      "accrual",
    );
    expect(ledger.rows).toHaveLength(3);
    expect(ledger.rows.map((r) => r.dateIso)).toEqual(["2026-01-01", "2026-01-10", "2026-01-15"]);
    expect(ledger.rows.map((r) => r.type)).toEqual([
      "operating_expense",
      "invoice_issued",
      "cost_of_sales",
    ]);
  });

  it("breaks a same-date tie by type, then reference, deterministically regardless of input order", () => {
    const build = (i: TransactionLedgerInputs) => buildTransactionLedger(i, RANGE, "cash");
    const a = build(
      inputs({
        payments: [payment({ paidAtIso: "2026-01-10", invoiceNumber: "VI-002", reference: null })],
        costs: [cost({ incurredDateIso: "2026-01-10", paidDateIso: "2026-01-10", quoteRef: "VQ-B" })],
        expenses: [expense({ incurredDateIso: "2026-01-10", paidDateIso: "2026-01-10", reference: "Z" })],
      }),
    );
    const b = build(
      inputs({
        expenses: [expense({ incurredDateIso: "2026-01-10", paidDateIso: "2026-01-10", reference: "Z" })],
        costs: [cost({ incurredDateIso: "2026-01-10", paidDateIso: "2026-01-10", quoteRef: "VQ-B" })],
        payments: [payment({ paidAtIso: "2026-01-10", invoiceNumber: "VI-002", reference: null })],
      }),
    );
    expect(a.rows.map((r) => r.type)).toEqual(["customer_payment", "cost_of_sales", "operating_expense"]);
    expect(a.rows).toEqual(b.rows);
  });

  it("sorts two same-date, same-type rows by reference", () => {
    const ledger = buildTransactionLedger(
      inputs({
        expenses: [
          expense({ incurredDateIso: "2026-01-10", reference: "B" }),
          expense({ incurredDateIso: "2026-01-10", reference: "A" }),
        ],
      }),
      RANGE,
      "accrual",
    );
    expect(ledger.rows.map((r) => r.reference)).toEqual(["A", "B"]);
  });

  it("returns an empty, fully zeroed ledger for empty data", () => {
    const ledger = buildTransactionLedger(inputs(), RANGE, "accrual");
    expect(ledger.rows).toEqual([]);
    expect(ledger.totalInJmd).toBe(0);
    expect(ledger.totalOutJmd).toBe(0);
    expect(ledger.netJmd).toBe(0);
    expect(ledger.gctCollectedJmd).toBe(0);
    expect(ledger.unresolvedRowCount).toBe(0);
  });
});

describe("buildTransactionLedger — filtering", () => {
  it("excludes rows whose basis date falls outside the range", () => {
    const ledger = buildTransactionLedger(
      inputs({
        issuedInvoices: [invoice({ issuedDateIso: "2025-12-31" })],
        expenses: [expense({ incurredDateIso: "2026-04-01" })],
        costs: [cost({ incurredDateIso: "2026-02-01" })],
      }),
      RANGE,
      "accrual",
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].type).toBe("cost_of_sales");
  });

  it("filters by a single type", () => {
    const ledger = buildTransactionLedger(
      inputs({ issuedInvoices: [invoice()], costs: [cost()], expenses: [expense()] }),
      RANGE,
      "accrual",
      { types: ["operating_expense"] },
    );
    expect(ledger.rows.map((r) => r.type)).toEqual(["operating_expense"]);
  });

  it("filters by several types at once", () => {
    const ledger = buildTransactionLedger(
      inputs({ issuedInvoices: [invoice()], costs: [cost()], expenses: [expense()] }),
      RANGE,
      "accrual",
      { types: ["invoice_issued", "cost_of_sales"] },
    );
    expect(ledger.rows.map((r) => r.type)).toEqual(["invoice_issued", "cost_of_sales"]);
  });

  it("treats an empty type list as 'all types'", () => {
    const ledger = buildTransactionLedger(
      inputs({ issuedInvoices: [invoice()], costs: [cost()], expenses: [expense()] }),
      RANGE,
      "accrual",
      { types: [] },
    );
    expect(ledger.rows).toHaveLength(3);
  });

  it("yields nothing for a type the basis cannot produce", () => {
    const ledger = buildTransactionLedger(
      inputs({ issuedInvoices: [invoice()], payments: [payment()] }),
      RANGE,
      "accrual",
      { types: ["customer_payment"] },
    );
    expect(ledger.rows).toEqual([]);
  });

  it("totals reflect the filter", () => {
    const scenario = inputs({
      issuedInvoices: [invoice({ revenueJmd: 1000 })],
      expenses: [expense({ amountJmd: 400 })],
    });
    expect(buildTransactionLedger(scenario, RANGE, "accrual").netJmd).toBe(600);

    const inOnly = buildTransactionLedger(scenario, RANGE, "accrual", { types: ["invoice_issued"] });
    expect(inOnly.totalOutJmd).toBe(0);
    expect(inOnly.netJmd).toBe(1000);
  });
});

describe("buildTransactionLedger — row contents", () => {
  it("carries reference, party, category and both dates on a cost row", () => {
    const ledger = buildTransactionLedger(inputs({ costs: [cost()] }), RANGE, "accrual");
    expect(ledger.rows[0]).toMatchObject({
      type: "cost_of_sales",
      reference: "VQ-2026-001",
      party: "Seaboard",
      category: "Freight",
      description: "Ocean freight, Miami–Kingston",
      incurredDateIso: "2026-01-15",
      paidDateIso: "2026-02-15",
    });
  });

  it("falls back to the client company when a cost has no supplier", () => {
    const ledger = buildTransactionLedger(inputs({ costs: [cost({ supplierName: null })] }), RANGE, "accrual");
    expect(ledger.rows[0].party).toBe("Sandals Resorts");
  });

  it("combines the invoice number with the bank reference on a payment row", () => {
    const ledger = buildTransactionLedger(inputs({ payments: [payment()] }), RANGE, "cash");
    expect(ledger.rows[0].reference).toBe("VI-2026-001 / TRX-9911");
    expect(ledger.rows[0].party).toBe("Sandals Resorts");
  });

  it("uses the invoice number alone when a payment has no bank reference", () => {
    const ledger = buildTransactionLedger(inputs({ payments: [payment({ reference: null })] }), RANGE, "cash");
    expect(ledger.rows[0].reference).toBe("VI-2026-001");
  });

  it("gives a payment no incurred date rather than inventing one", () => {
    const ledger = buildTransactionLedger(inputs({ payments: [payment()] }), RANGE, "cash");
    expect(ledger.rows[0].incurredDateIso).toBeNull();
    expect(ledger.rows[0].paidDateIso).toBe("2026-02-05");
  });

  it("keeps both dates on every cost/expense row, whichever basis dated it", () => {
    for (const basis of BASES) {
      const ledger = buildTransactionLedger(inputs({ costs: [cost()] }), RANGE, basis);
      expect(ledger.rows[0].incurredDateIso).toBe("2026-01-15");
      expect(ledger.rows[0].paidDateIso).toBe("2026-02-15");
    }
  });
});

describe("buildTransactionLedger — currency and FX basis", () => {
  it("marks a JMD-recorded row as native and leaves the amount untouched", () => {
    const ledger = buildTransactionLedger(inputs({ costs: [cost({ amountJmd: 90_000 })] }), RANGE, "accrual");
    expect(ledger.rows[0]).toMatchObject({ amountJmd: 90_000, amountUsd: null, resolvedJmd: 90_000, fxBasis: "native" });
  });

  it("converts a USD-only COST at the order's locked rate and labels it as such", () => {
    const ledger = buildTransactionLedger(
      inputs({ costs: [cost({ amountJmd: null, amountUsd: 1000 })] }),
      RANGE,
      "accrual",
    );
    expect(ledger.rows[0]).toMatchObject({ amountUsd: 1000, resolvedJmd: 200_000, fxBasis: "order_rate" });
  });

  it("converts a USD-only EXPENSE at the current rate and labels it differently", () => {
    const ledger = buildTransactionLedger(
      inputs({ expenses: [expense({ amountJmd: null, amountUsd: 1000 })] }),
      RANGE,
      "accrual",
    );
    expect(ledger.rows[0]).toMatchObject({ amountUsd: 1000, resolvedJmd: 100_000, fxBasis: "current_rate" });
  });

  it("never overwrites the recorded amounts with the converted figure", () => {
    const ledger = buildTransactionLedger(
      inputs({ costs: [cost({ amountJmd: null, amountUsd: 1000 })] }),
      RANGE,
      "accrual",
    );
    expect(ledger.rows[0].amountJmd).toBeNull();
    expect(ledger.rows[0].amountUsd).toBe(1000);
  });

  it("marks an unconvertible row rather than counting it as zero, and reports the shortfall", () => {
    const ledger = buildTransactionLedger(
      inputs({
        costs: [cost({ orderId: "unknown", amountJmd: null, amountUsd: 500 })],
        expenses: [expense({ amountJmd: null, amountUsd: 200 })],
        fx: NO_FX,
      }),
      RANGE,
      "accrual",
    );
    expect(ledger.rows.every((r) => r.fxBasis === "unconverted" && r.resolvedJmd === null)).toBe(true);
    expect(ledger.totalOutJmd).toBe(0);
    expect(ledger.unresolvedRowCount).toBe(2);
    expect(ledger.unresolvedUsd).toBe(700);
  });
});

describe("buildTransactionLedger — totals", () => {
  it("sums money in and money out separately and nets them", () => {
    const ledger = buildTransactionLedger(
      inputs({
        payments: [
          payment({ amountJmd: 1_000_000 }),
          payment({ amountJmd: 500_000, paidAtIso: "2026-03-01" }),
        ],
        costs: [cost({ amountJmd: 600_000, paidDateIso: "2026-02-15" })],
        expenses: [expense({ amountJmd: 150_000, paidDateIso: "2026-01-05" })],
      }),
      RANGE,
      "cash",
    );
    expect(ledger.totalInJmd).toBe(1_500_000);
    expect(ledger.totalOutJmd).toBe(750_000);
    expect(ledger.netJmd).toBe(750_000);
  });

  it("nets negative when more went out than came in", () => {
    const ledger = buildTransactionLedger(
      inputs({ payments: [payment({ amountJmd: 100 })], expenses: [expense({ amountJmd: 900 })] }),
      RANGE,
      "cash",
    );
    expect(ledger.netJmd).toBe(-800);
  });

  it("agrees with the declared direction of each type", () => {
    expect(TRANSACTION_DIRECTION.invoice_issued).toBe(1);
    expect(TRANSACTION_DIRECTION.customer_payment).toBe(1);
    expect(TRANSACTION_DIRECTION.cost_of_sales).toBe(-1);
    expect(TRANSACTION_DIRECTION.operating_expense).toBe(-1);
  });
});

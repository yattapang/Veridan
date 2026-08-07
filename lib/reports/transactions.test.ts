import { describe, expect, it } from "vitest";
import { buildCurrentFxRate } from "../expenses/expense";
import type { ReportDateRange } from "./period";
import {
  buildTransactionLedger,
  parseTransactionTypes,
  TRANSACTION_DIRECTION,
  type LedgerCostInput,
  type LedgerExpenseInput,
  type LedgerPaymentInput,
  type TransactionLedgerInputs,
} from "./transactions";

const RANGE: ReportDateRange = { startIso: "2026-01-01", endIso: "2026-03-31" };
const ORDER_RATES = { o1: 200 };
const FX = buildCurrentFxRate(100, 0); // current rate, deliberately != the order rate
const NO_FX = buildCurrentFxRate(null, null);

function payment(overrides: Partial<LedgerPaymentInput> = {}): LedgerPaymentInput {
  return {
    amountJmd: 400_000,
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
    payments: [],
    costs: [],
    expenses: [],
    rateByOrderId: ORDER_RATES,
    fx: FX,
    ...overrides,
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
    expect(parseTransactionTypes("customer_payment,operating_expense")).toEqual([
      "customer_payment",
      "operating_expense",
    ]);
  });

  it("drops unknown values instead of erroring, and de-duplicates", () => {
    expect(parseTransactionTypes(["bogus", "cost_of_sales", "cost_of_sales"])).toEqual(["cost_of_sales"]);
  });
});

describe("buildTransactionLedger — merge and ordering", () => {
  it("merges all three sources into one chronological listing", () => {
    const ledger = buildTransactionLedger(
      inputs({ payments: [payment()], costs: [cost()], expenses: [expense()] }),
      RANGE,
    );
    expect(ledger.rows).toHaveLength(3);
    expect(ledger.rows.map((r) => r.dateIso)).toEqual(["2026-01-01", "2026-01-15", "2026-02-05"]);
    expect(ledger.rows.map((r) => r.type)).toEqual([
      "operating_expense",
      "cost_of_sales",
      "customer_payment",
    ]);
  });

  it("places each row at its own primary date — payment date for a payment, incurred date for costs/expenses", () => {
    const ledger = buildTransactionLedger(
      inputs({
        payments: [payment({ paidAtIso: "2026-03-01" })],
        costs: [cost({ incurredDateIso: "2026-01-15", paidDateIso: "2026-03-20" })],
        expenses: [expense({ incurredDateIso: "2026-01-02", paidDateIso: "2026-03-25" })],
      }),
      RANGE,
    );
    expect(ledger.rows.map((r) => r.dateIso)).toEqual(["2026-01-02", "2026-01-15", "2026-03-01"]);
  });

  it("breaks a same-date tie by type, then reference, deterministically regardless of input order", () => {
    const a = buildTransactionLedger(
      inputs({
        payments: [payment({ paidAtIso: "2026-01-10", invoiceNumber: "VI-002", reference: null })],
        costs: [cost({ incurredDateIso: "2026-01-10", quoteRef: "VQ-B" })],
        expenses: [expense({ incurredDateIso: "2026-01-10", reference: "Z" })],
      }),
      RANGE,
    );
    const b = buildTransactionLedger(
      inputs({
        expenses: [expense({ incurredDateIso: "2026-01-10", reference: "Z" })],
        costs: [cost({ incurredDateIso: "2026-01-10", quoteRef: "VQ-B" })],
        payments: [payment({ paidAtIso: "2026-01-10", invoiceNumber: "VI-002", reference: null })],
      }),
      RANGE,
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
    );
    expect(ledger.rows.map((r) => r.reference)).toEqual(["A", "B"]);
  });

  it("returns an empty, fully zeroed ledger for empty data", () => {
    const ledger = buildTransactionLedger(inputs(), RANGE);
    expect(ledger.rows).toEqual([]);
    expect(ledger.totalInJmd).toBe(0);
    expect(ledger.totalOutJmd).toBe(0);
    expect(ledger.netJmd).toBe(0);
    expect(ledger.unresolvedRowCount).toBe(0);
  });
});

describe("buildTransactionLedger — filtering", () => {
  it("excludes rows whose primary date falls outside the range", () => {
    const ledger = buildTransactionLedger(
      inputs({
        payments: [payment({ paidAtIso: "2025-12-31" })],
        expenses: [expense({ incurredDateIso: "2026-04-01" })],
        costs: [cost({ incurredDateIso: "2026-02-01" })],
      }),
      RANGE,
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].type).toBe("cost_of_sales");
  });

  it("filters by a single type", () => {
    const ledger = buildTransactionLedger(
      inputs({ payments: [payment()], costs: [cost()], expenses: [expense()] }),
      RANGE,
      { types: ["operating_expense"] },
    );
    expect(ledger.rows.map((r) => r.type)).toEqual(["operating_expense"]);
  });

  it("filters by several types at once", () => {
    const ledger = buildTransactionLedger(
      inputs({ payments: [payment()], costs: [cost()], expenses: [expense()] }),
      RANGE,
      { types: ["customer_payment", "cost_of_sales"] },
    );
    expect(ledger.rows.map((r) => r.type)).toEqual(["cost_of_sales", "customer_payment"]);
  });

  it("treats an empty type list as 'all types'", () => {
    const ledger = buildTransactionLedger(
      inputs({ payments: [payment()], costs: [cost()], expenses: [expense()] }),
      RANGE,
      { types: [] },
    );
    expect(ledger.rows).toHaveLength(3);
  });

  it("totals reflect the filter", () => {
    const all = buildTransactionLedger(
      inputs({ payments: [payment({ amountJmd: 1000 })], expenses: [expense({ amountJmd: 400 })] }),
      RANGE,
    );
    expect(all.netJmd).toBe(600);

    const inOnly = buildTransactionLedger(
      inputs({ payments: [payment({ amountJmd: 1000 })], expenses: [expense({ amountJmd: 400 })] }),
      RANGE,
      { types: ["customer_payment"] },
    );
    expect(inOnly.totalOutJmd).toBe(0);
    expect(inOnly.netJmd).toBe(1000);
  });
});

describe("buildTransactionLedger — row contents", () => {
  it("carries reference, party, category and both dates on a cost row", () => {
    const ledger = buildTransactionLedger(inputs({ costs: [cost()] }), RANGE);
    const row = ledger.rows[0];
    expect(row).toMatchObject({
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
    const ledger = buildTransactionLedger(inputs({ costs: [cost({ supplierName: null })] }), RANGE);
    expect(ledger.rows[0].party).toBe("Sandals Resorts");
  });

  it("combines the invoice number with the bank reference on a payment row", () => {
    const ledger = buildTransactionLedger(inputs({ payments: [payment()] }), RANGE);
    expect(ledger.rows[0].reference).toBe("VI-2026-001 / TRX-9911");
    expect(ledger.rows[0].party).toBe("Sandals Resorts");
  });

  it("uses the invoice number alone when a payment has no bank reference", () => {
    const ledger = buildTransactionLedger(inputs({ payments: [payment({ reference: null })] }), RANGE);
    expect(ledger.rows[0].reference).toBe("VI-2026-001");
  });

  it("gives a payment no incurred date rather than inventing one", () => {
    const ledger = buildTransactionLedger(inputs({ payments: [payment()] }), RANGE);
    expect(ledger.rows[0].incurredDateIso).toBeNull();
    expect(ledger.rows[0].paidDateIso).toBe("2026-02-05");
  });

  it("keeps an unpaid row visible with a null paid date", () => {
    const ledger = buildTransactionLedger(inputs({ expenses: [expense({ paidDateIso: null })] }), RANGE);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].paidDateIso).toBeNull();
  });
});

describe("buildTransactionLedger — currency and FX basis", () => {
  it("marks a JMD-recorded row as native and leaves the amount untouched", () => {
    const ledger = buildTransactionLedger(inputs({ costs: [cost({ amountJmd: 90_000 })] }), RANGE);
    expect(ledger.rows[0]).toMatchObject({ amountJmd: 90_000, amountUsd: null, resolvedJmd: 90_000, fxBasis: "native" });
  });

  it("converts a USD-only COST at the order's locked rate and labels it as such", () => {
    const ledger = buildTransactionLedger(
      inputs({ costs: [cost({ amountJmd: null, amountUsd: 1000 })] }),
      RANGE,
    );
    expect(ledger.rows[0]).toMatchObject({ amountUsd: 1000, resolvedJmd: 200_000, fxBasis: "order_rate" });
  });

  it("converts a USD-only EXPENSE at the current rate and labels it differently", () => {
    const ledger = buildTransactionLedger(
      inputs({ expenses: [expense({ amountJmd: null, amountUsd: 1000 })] }),
      RANGE,
    );
    expect(ledger.rows[0]).toMatchObject({ amountUsd: 1000, resolvedJmd: 100_000, fxBasis: "current_rate" });
  });

  it("never overwrites the recorded amounts with the converted figure", () => {
    const ledger = buildTransactionLedger(
      inputs({ costs: [cost({ amountJmd: null, amountUsd: 1000 })] }),
      RANGE,
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
        payments: [payment({ amountJmd: 1_000_000 }), payment({ amountJmd: 500_000, paidAtIso: "2026-03-01" })],
        costs: [cost({ amountJmd: 600_000 })],
        expenses: [expense({ amountJmd: 150_000 })],
      }),
      RANGE,
    );
    expect(ledger.totalInJmd).toBe(1_500_000);
    expect(ledger.totalOutJmd).toBe(750_000);
    expect(ledger.netJmd).toBe(750_000);
  });

  it("nets negative when more went out than came in", () => {
    const ledger = buildTransactionLedger(
      inputs({ payments: [payment({ amountJmd: 100 })], expenses: [expense({ amountJmd: 900 })] }),
      RANGE,
    );
    expect(ledger.netJmd).toBe(-800);
  });

  it("agrees with the declared direction of each type", () => {
    expect(TRANSACTION_DIRECTION.customer_payment).toBe(1);
    expect(TRANSACTION_DIRECTION.cost_of_sales).toBe(-1);
    expect(TRANSACTION_DIRECTION.operating_expense).toBe(-1);
  });
});

import { describe, expect, it } from "vitest";
import { buildCurrentFxRate } from "../expenses/expense";
import type { ReportBasis } from "./basis";
import { computeCashFlowByMonth, type CashOutEntry } from "./cashflow";
import {
  buildIncomeStatement,
  roundJmd,
  type IncomeStatementInputs,
  type IssuedInvoiceInput,
} from "./incomeStatement";
import type { ReportDateRange } from "./period";
import { cashFlowToCsvRows, incomeStatementToCsvRows, transactionLedgerToCsvRows } from "./serialize";
import {
  buildTransactionLedger,
  type LedgerCostInput,
  type LedgerInvoiceInput,
  type TransactionLedgerInputs,
} from "./transactions";
import type { CsvCell } from "./csv";

const RANGE: ReportDateRange = { startIso: "2026-01-01", endIso: "2026-03-31" };
const FX = buildCurrentFxRate(162, 3);
const BASES: ReportBasis[] = ["accrual", "cash"];

/** Flattens the matrix so a test can ask "does this file say X anywhere?". */
function textOf(rows: CsvCell[][]): string {
  return rows.map((r) => r.map((c) => (c == null ? "" : String(c))).join(" | ")).join("\n");
}

function invoice(revenueJmd: number, gctJmd = 0): LedgerInvoiceInput {
  return {
    grossAmountJmd: roundJmd(revenueJmd + gctJmd),
    revenueJmd,
    gctJmd,
    issuedDateIso: "2026-01-10",
    orderId: "o1",
    quoteRef: "VQ-2026-001",
    invoiceNumber: "VI-2026-001",
    companyName: "Sandals Resorts",
  };
}

function cost(overrides: Partial<LedgerCostInput> = {}): LedgerCostInput {
  return {
    orderId: "o1",
    category: "freight",
    amountUsd: null,
    amountJmd: 600_000,
    incurredDateIso: "2026-01-15",
    paidDateIso: "2026-02-15",
    description: "Ocean freight",
    supplierName: "Seaboard",
    quoteRef: "VQ-2026-001",
    companyName: "Sandals Resorts",
    ...overrides,
  };
}

function ledgerInputs(overrides: Partial<TransactionLedgerInputs> = {}): TransactionLedgerInputs {
  return {
    issuedInvoices: [],
    payments: [],
    costs: [],
    expenses: [],
    rateByOrderId: { o1: 200 },
    fx: FX,
    ...overrides,
  };
}

function statementInputs(issuedInvoices: IssuedInvoiceInput[], costs: LedgerCostInput[]): IncomeStatementInputs {
  return { issuedInvoices, payments: [], costs, expenses: [], rateByOrderId: { o1: 200 }, fx: FX };
}

// ---------------------------------------------------------------------------

describe("cashFlowToCsvRows — FX disclosure (MAJOR M-3)", () => {
  const outEntry: CashOutEntry = {
    amountJmd: 30_000,
    paidAtIso: "2026-02-05",
    kind: "operating_expense",
    categoryLabel: "Software",
    description: "Hosting",
    party: "Vercel",
    reference: null,
  };
  const monthly = computeCashFlowByMonth([], RANGE, [outEntry]);

  it("prints the live-rate caveat, with the actual rate, when one was applied", () => {
    const text = textOf(cashFlowToCsvRows(monthly, RANGE, "162.00 x 1.03 = 166.86 JMD per USD"));
    expect(text).toContain("FX note");
    expect(text).toContain("162.00 x 1.03 = 166.86 JMD per USD");
    expect(text).toContain("CURRENT business-parameter rate");
  });

  it("omits it entirely when nothing in the file depended on the live rate", () => {
    const text = textOf(cashFlowToCsvRows(monthly, RANGE));
    expect(text).not.toContain("FX note");
  });

  it("still emits the monthly summary and both detail blocks either way", () => {
    for (const note of [null, "162.00 x 1.03 = 166.86 JMD per USD"]) {
      const text = textOf(cashFlowToCsvRows(monthly, RANGE, note));
      expect(text).toContain("Monthly summary");
      expect(text).toContain("Cash in — detail (customer payments)");
      expect(text).toContain("Cash out — detail (costs and expenses paid)");
    }
  });
});

describe("incomeStatementToCsvRows — GCT memo (MAJOR M-1)", () => {
  it("emits GCT as a memo, clearly marked as not revenue and outside every figure", () => {
    const statement = buildIncomeStatement(
      statementInputs([invoice(1_000_000, 150_000)], [cost()]),
      RANGE,
      "accrual",
    );
    const rows = incomeStatementToCsvRows(statement);
    const text = textOf(rows);

    expect(text).toContain("Memo — not revenue, not part of any figure above");
    expect(text).toContain("GCT collected (JMD, accrual basis)");
    expect(text).toContain("A liability, never income");

    // Revenue stays GCT-exclusive on the statement line itself.
    const revenueRow = rows.find((r) => r[0] === "Revenue");
    expect(revenueRow?.[1]).toBe(1_000_000);
    const gctRow = rows.find((r) => String(r[0]).startsWith("GCT collected"));
    expect(gctRow?.[1]).toBe(150_000);
  });

  it("states the basis on the memo line, on both bases", () => {
    for (const basis of BASES) {
      const statement = buildIncomeStatement(statementInputs([invoice(1_000_000, 150_000)], []), RANGE, basis);
      expect(textOf(incomeStatementToCsvRows(statement))).toContain(`GCT collected (JMD, ${basis} basis)`);
    }
  });

  it("explains that a cost-only order row is why the per-order block reconciles (MAJOR M-2)", () => {
    const statement = buildIncomeStatement(statementInputs([], [cost()]), RANGE, "accrual");
    expect(textOf(incomeStatementToCsvRows(statement))).toContain("including an order whose revenue falls outside");
  });
});

describe("transactionLedgerToCsvRows — the basis is inescapable (BLOCKER B-1)", () => {
  const scenario = ledgerInputs({ issuedInvoices: [invoice(1_000_000, 150_000)], costs: [cost()] });

  for (const basis of BASES) {
    it(`${basis}: states the basis in the title, the preamble, the headers and every total`, () => {
      const ledger = buildTransactionLedger(scenario, RANGE, basis);
      const rows = transactionLedgerToCsvRows(ledger);
      const text = textOf(rows);

      expect(rows[0][0]).toBe(
        `Veridan — Transaction detail (general ledger, ${basis === "cash" ? "Cash" : "Accrual"} basis)`,
      );
      expect(text).toContain(`Date (${basis} basis)`);
      expect(text).toContain(`Money in (JMD, ${basis} basis)`);
      expect(text).toContain(`Money out (JMD, ${basis} basis)`);
      expect(text).toContain(`Net (JMD, ${basis} basis)`);
    });
  }

  it("says, in the file itself, that it reconciles to the income statement", () => {
    const text = textOf(transactionLedgerToCsvRows(buildTransactionLedger(scenario, RANGE, "accrual")));
    expect(text).toContain("RECONCILES to the income statement");
  });

  it("carries the GCT column and the GCT memo total", () => {
    const ledger = buildTransactionLedger(scenario, RANGE, "accrual");
    const rows = transactionLedgerToCsvRows(ledger);
    const header = rows.find((r) => r[0] === "Date (accrual basis)")!;
    const gctColumn = header.indexOf("GCT (JMD, not revenue)");
    expect(gctColumn).toBeGreaterThan(-1);

    const invoiceRow = rows.find((r) => r[1] === "Invoice Issued")!;
    expect(invoiceRow[6]).toBe(1_150_000); // as recorded, gross
    expect(invoiceRow[8]).toBe(1_000_000); // for totalling, net of GCT
    expect(invoiceRow[gctColumn]).toBe(150_000);

    expect(textOf(rows)).toContain("GCT collected (JMD, accrual basis) — memo, not revenue");
  });

  it("the totals block carries the same numbers the ledger computed", () => {
    const ledger = buildTransactionLedger(scenario, RANGE, "accrual");
    const rows = transactionLedgerToCsvRows(ledger);
    expect(rows.find((r) => String(r[0]).startsWith("Money in"))?.[1]).toBe(ledger.totalInJmd);
    expect(rows.find((r) => String(r[0]).startsWith("Money out"))?.[1]).toBe(ledger.totalOutJmd);
    expect(rows.find((r) => String(r[0]).startsWith("Net (JMD"))?.[1]).toBe(ledger.netJmd);
  });
});

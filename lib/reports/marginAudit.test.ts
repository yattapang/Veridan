import { describe, expect, it } from "vitest";
import {
  ACTUAL_TO_VARIANCE_CATEGORY,
  buildMarginAudit,
  quotedCategoriesFromOrigins,
  quotedEffectiveMarginPct,
  type MarginAuditCostInput,
  type MarginAuditInvoiceInput,
  type MarginAuditOrderInput,
  type MarginAuditPaymentInput,
  type QuoteOriginCostRow,
} from "./marginAudit";

const RATE = 166.86; // JMD per 1 USD

function order(overrides: Partial<MarginAuditOrderInput> = {}): MarginAuditOrderInput {
  return {
    orderId: "o1",
    quoteRef: "VQ-2026-001",
    orderStatus: "confirmed",
    quotedLandedUsd: 10000,
    quotedClientUsd: 14285.71, // ~30% margin
    quotedClientJmd: 2_000_000,
    marginFloorPct: 20,
    effectiveRate: RATE,
    quotedCategoriesUsd: { hardware: 7000, freight: 1500, insurance: 200, brokerage_port: 300, duty: 1000 },
    ...overrides,
  };
}

describe("quotedCategoriesFromOrigins", () => {
  it("sums the engine's cost components across origins with the documented mapping", () => {
    const origins: QuoteOriginCostRow[] = [
      {
        supplier_invoice_total: 5000,
        freight_export_fees_usd: 200,
        ocean_freight_usd: 800,
        marine_insurance_usd: 90,
        port_handling_usd: 50,
        brokerage_usd: 120,
        cif_basis_usd: 6000,
        duty_gct_pct: 55,
      },
      {
        supplier_invoice_total: 2000,
        freight_export_fees_usd: null,
        ocean_freight_usd: 500,
        marine_insurance_usd: null,
        port_handling_usd: 50,
        brokerage_usd: 170,
        cif_basis_usd: 2500,
        duty_gct_pct: 55,
      },
    ];
    const cats = quotedCategoriesFromOrigins(origins);
    expect(cats.hardware).toBe(7000);
    expect(cats.freight).toBe(200 + 800 + 0 + 500);
    expect(cats.insurance).toBe(90);
    expect(cats.brokerage_port).toBe(120 + 50 + 170 + 50);
    expect(cats.duty).toBeCloseTo(6000 * 0.55 + 2500 * 0.55, 6);
  });

  it("treats every null column as zero", () => {
    const cats = quotedCategoriesFromOrigins([
      {
        supplier_invoice_total: null,
        freight_export_fees_usd: null,
        ocean_freight_usd: null,
        marine_insurance_usd: null,
        port_handling_usd: null,
        brokerage_usd: null,
        cif_basis_usd: null,
        duty_gct_pct: null,
      },
    ]);
    expect(cats).toEqual({ hardware: 0, freight: 0, insurance: 0, brokerage_port: 0, duty: 0 });
  });
});

describe("quotedEffectiveMarginPct", () => {
  it("computes (client - landed)/client percent", () => {
    expect(quotedEffectiveMarginPct(1000, 700)).toBeCloseTo(30, 6);
  });
  it("returns null when client is missing or non-positive", () => {
    expect(quotedEffectiveMarginPct(null, 700)).toBeNull();
    expect(quotedEffectiveMarginPct(0, 700)).toBeNull();
    expect(quotedEffectiveMarginPct(1000, null)).toBeNull();
  });
});

describe("category mapping", () => {
  it("merges brokerage and port_handling, and buckets delivery/other as uncategorized", () => {
    expect(ACTUAL_TO_VARIANCE_CATEGORY.brokerage).toBe("brokerage_port");
    expect(ACTUAL_TO_VARIANCE_CATEGORY.port_handling).toBe("brokerage_port");
    expect(ACTUAL_TO_VARIANCE_CATEGORY.delivery).toBe("uncategorized");
    expect(ACTUAL_TO_VARIANCE_CATEGORY.other).toBe("uncategorized");
  });
});

describe("buildMarginAudit — cost variances", () => {
  it("computes actual costs in both currencies and per-category variance", () => {
    const costs: MarginAuditCostInput[] = [
      { orderId: "o1", category: "hardware", amountUsd: 7500, amountJmd: null },
      { orderId: "o1", category: "freight", amountUsd: null, amountJmd: 166_860 }, // = 1000 USD at RATE
      { orderId: "o1", category: "brokerage", amountUsd: 200, amountJmd: null },
      { orderId: "o1", category: "port_handling", amountUsd: 60, amountJmd: null },
      { orderId: "o1", category: "delivery", amountUsd: 300, amountJmd: null }, // uncategorized
    ];
    const { rows } = buildMarginAudit([order()], costs, [], []);
    const row = rows[0];
    expect(row.actualCostUsd).toBeCloseTo(7500 + 1000 + 200 + 60 + 300, 2);
    // JMD side: USD rows convert usd->jmd, the JMD-only freight row stays put.
    expect(row.actualCostJmd).toBeCloseTo(7500 * RATE + 166_860 + 200 * RATE + 60 * RATE + 300 * RATE, 0);
    expect(row.uncategorizedActualUsd).toBe(300);

    const hardware = row.categories.find((c) => c.category === "hardware")!;
    expect(hardware.quotedUsd).toBe(7000);
    expect(hardware.actualUsd).toBe(7500);
    expect(hardware.varianceUsd).toBe(500);

    const freight = row.categories.find((c) => c.category === "freight")!;
    expect(freight.actualUsd).toBeCloseTo(1000, 6);
    expect(freight.varianceUsd).toBeCloseTo(1000 - 1500, 6);

    const bp = row.categories.find((c) => c.category === "brokerage_port")!;
    expect(bp.actualUsd).toBe(260);
    expect(bp.varianceUsd).toBe(260 - 300);

    // total cost variance = total actual - quoted landed
    expect(row.totalCostVarianceUsd).toBeCloseTo(9060 - 10000, 2);
  });
});

describe("buildMarginAudit — realized margin & floor drift", () => {
  it("uses realized (cash-basis) margin when the order is fully paid and closed", () => {
    const order1 = order({ orderStatus: "closed" });
    const costs: MarginAuditCostInput[] = [
      { orderId: "o1", category: "hardware", amountUsd: null, amountJmd: 1_500_000 },
    ];
    const invoices: MarginAuditInvoiceInput[] = [
      { orderId: "o1", amountJmd: 1_200_000, status: "paid" },
      { orderId: "o1", amountJmd: 800_000, status: "paid" },
    ];
    const payments: MarginAuditPaymentInput[] = [
      { orderId: "o1", amountJmd: 1_200_000 },
      { orderId: "o1", amountJmd: 800_000 },
    ];
    const { rows } = buildMarginAudit([order1], costs, payments, invoices);
    const row = rows[0];
    expect(row.isComplete).toBe(true);
    expect(row.fullyPaid).toBe(true);
    // (2,000,000 - 1,500,000) / 2,000,000 = 25%
    expect(row.realizedMarginPct).toBeCloseTo(25, 6);
    expect(row.marginForFloorCheckPct).toBeCloseTo(25, 6);
    expect(row.floorDrift).toBe(false);
    expect(row.completenessNote).toBeNull();
  });

  it("flags floor drift when the complete order's realized margin is below the snapshot floor", () => {
    const order1 = order({ orderStatus: "closed", marginFloorPct: 20 });
    const costs: MarginAuditCostInput[] = [
      { orderId: "o1", category: "hardware", amountUsd: null, amountJmd: 1_850_000 },
    ];
    const invoices: MarginAuditInvoiceInput[] = [{ orderId: "o1", amountJmd: 2_000_000, status: "paid" }];
    const payments: MarginAuditPaymentInput[] = [{ orderId: "o1", amountJmd: 2_000_000 }];
    const { rows, rollup } = buildMarginAudit([order1], costs, payments, invoices);
    const row = rows[0];
    // (2,000,000 - 1,850,000)/2,000,000 = 7.5% < 20% floor
    expect(row.realizedMarginPct).toBeCloseTo(7.5, 6);
    expect(row.floorDrift).toBe(true);
    expect(rollup.flaggedCount).toBe(1);
  });

  it("uses projected-realized margin and a completeness note while the order is in flight", () => {
    const order1 = order({ orderStatus: "in_procurement", quotedClientJmd: 2_000_000 });
    // Only a deposit collected so far, but a big cost already incurred.
    const invoices: MarginAuditInvoiceInput[] = [{ orderId: "o1", amountJmd: 1_200_000, status: "partially_paid" }];
    const payments: MarginAuditPaymentInput[] = [{ orderId: "o1", amountJmd: 1_200_000 }];
    const costs: MarginAuditCostInput[] = [
      { orderId: "o1", category: "hardware", amountUsd: null, amountJmd: 1_400_000 },
    ];
    const { rows } = buildMarginAudit([order1], costs, payments, invoices);
    const row = rows[0];
    expect(row.isComplete).toBe(false);
    expect(row.completenessNote).toContain("Provisional");
    // projected revenue = max(invoiced 1.2M, quoted 2.0M, paid 1.2M) = 2.0M
    expect(row.projectedRevenueJmd).toBe(2_000_000);
    // (2,000,000 - 1,400,000)/2,000,000 = 30%
    expect(row.projectedRealizedMarginPct).toBeCloseTo(30, 6);
    expect(row.marginForFloorCheckPct).toBeCloseTo(30, 6);
    // Realized (cash-basis) column is still the raw partial figure.
    expect(row.realizedMarginPct).toBeCloseTo(((1_200_000 - 1_400_000) / 1_200_000) * 100, 6);
  });

  it("excludes void invoices from the billed total", () => {
    const order1 = order({ orderStatus: "closed" });
    const invoices: MarginAuditInvoiceInput[] = [
      { orderId: "o1", amountJmd: 2_000_000, status: "paid" },
      { orderId: "o1", amountJmd: 999_999, status: "void" },
    ];
    const payments: MarginAuditPaymentInput[] = [{ orderId: "o1", amountJmd: 2_000_000 }];
    const { rows } = buildMarginAudit([order1], [], payments, invoices);
    expect(rows[0].totalInvoicedJmd).toBe(2_000_000);
    expect(rows[0].fullyPaid).toBe(true);
  });
});

describe("buildMarginAudit — sorting & rollup", () => {
  it("sorts flagged orders first, then by floor-check margin ascending", () => {
    const flagged = order({ orderId: "flag", quoteRef: "VQ-FLAG", orderStatus: "closed", marginFloorPct: 20 });
    const healthy = order({ orderId: "good", quoteRef: "VQ-GOOD", orderStatus: "closed", marginFloorPct: 20 });
    const midHealthy = order({ orderId: "mid", quoteRef: "VQ-MID", orderStatus: "closed", marginFloorPct: 20 });

    const invoices: MarginAuditInvoiceInput[] = [
      { orderId: "flag", amountJmd: 1_000_000, status: "paid" },
      { orderId: "good", amountJmd: 1_000_000, status: "paid" },
      { orderId: "mid", amountJmd: 1_000_000, status: "paid" },
    ];
    const payments: MarginAuditPaymentInput[] = [
      { orderId: "flag", amountJmd: 1_000_000 },
      { orderId: "good", amountJmd: 1_000_000 },
      { orderId: "mid", amountJmd: 1_000_000 },
    ];
    const costs: MarginAuditCostInput[] = [
      { orderId: "flag", category: "hardware", amountUsd: null, amountJmd: 900_000 }, // 10% -> flagged
      { orderId: "good", category: "hardware", amountUsd: null, amountJmd: 500_000 }, // 50%
      { orderId: "mid", category: "hardware", amountUsd: null, amountJmd: 700_000 }, // 30%
    ];
    const { rows } = buildMarginAudit([healthy, midHealthy, flagged], costs, payments, invoices);
    expect(rows.map((r) => r.orderId)).toEqual(["flag", "mid", "good"]);
  });

  it("rolls up portfolio realized margin and per-category totals", () => {
    const o1 = order({ orderId: "a", quoteRef: "A", orderStatus: "closed" });
    const o2 = order({ orderId: "b", quoteRef: "B", orderStatus: "closed" });
    const payments: MarginAuditPaymentInput[] = [
      { orderId: "a", amountJmd: 1_000_000 },
      { orderId: "b", amountJmd: 1_000_000 },
    ];
    const costs: MarginAuditCostInput[] = [
      { orderId: "a", category: "hardware", amountUsd: null, amountJmd: 600_000 },
      { orderId: "b", category: "hardware", amountUsd: null, amountJmd: 800_000 },
    ];
    const { rollup } = buildMarginAudit([o1, o2], costs, payments, []);
    expect(rollup.orderCount).toBe(2);
    // (2,000,000 - 1,400,000)/2,000,000 = 30%
    expect(rollup.realizedMarginPct).toBeCloseTo(30, 6);
    expect(rollup.totalQuotedLandedUsd).toBe(20000);
    const hardware = rollup.categories.find((c) => c.category === "hardware")!;
    expect(hardware.quotedUsd).toBe(14000);
  });
});

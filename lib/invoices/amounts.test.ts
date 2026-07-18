import { describe, expect, it } from "vitest";
import type { FxSnapshotStored, ParametersSnapshotStored } from "@/lib/supabase/types";
import { buildFxNote, computeBalanceInvoiceAmounts, computeDepositInvoiceAmounts } from "./amounts";

function fx(overrides: Partial<FxSnapshotStored> = {}): FxSnapshotStored {
  return {
    bank_sell_rate: 162,
    fx_buffer_pct: 3,
    effective_rate: 166.86,
    supplier_rates: { USD: 1 },
    source: "manual admin entry",
    as_of: "2026-07-15",
    ...overrides,
  };
}

function params(overrides: Partial<ParametersSnapshotStored> = {}): ParametersSnapshotStored {
  return {
    duty_gct_pct: 55,
    marine_insurance_pct: 1.5,
    brokerage_first_pallet_usd: 120,
    brokerage_addl_pallet_usd: 50,
    port_handling_usd: 50,
    freight_insurance_fallback_usd: 1250,
    procurement_handling_fee_usd: 500,
    contingency_pct: 5,
    margin_tiers: [30, 35, 40],
    margin_floor_pct: 20,
    min_order_value_usd: 2000,
    deposit_standard_pct: 60,
    quote_validity_days: 15,
    default_finish: "Satin Stainless Steel (US32D)",
    gct_enabled: false,
    gct_rate_pct: 15,
    lead_times: {},
    company_details: {},
    ...overrides,
  };
}

describe("buildFxNote", () => {
  it("renders the worked example from the task brief", () => {
    expect(buildFxNote(fx())).toBe("162.00 x 1.03 = 166.86");
  });
});

describe("computeDepositInvoiceAmounts", () => {
  it("computes subtotal = total x deposit_pct/100 with GCT off", () => {
    const result = computeDepositInvoiceAmounts({
      total_client_jmd: 100000,
      deposit_pct: 60,
      parameters_snapshot: params({ gct_enabled: false }),
      fx_snapshot: fx(),
    });
    expect(result.subtotalJmd).toBe(60000);
    expect(result.gctAmountJmd).toBe(0);
    expect(result.amountJmd).toBe(60000);
  });

  it("adds GCT on top of the subtotal when the quote's own snapshot has it enabled", () => {
    const result = computeDepositInvoiceAmounts({
      total_client_jmd: 100000,
      deposit_pct: 60,
      parameters_snapshot: params({ gct_enabled: true, gct_rate_pct: 15 }),
      fx_snapshot: fx(),
    });
    expect(result.subtotalJmd).toBe(60000);
    expect(result.gctAmountJmd).toBe(9000);
    expect(result.amountJmd).toBe(69000);
  });

  it("never applies GCT when the frozen snapshot has it off, even if a live rate would differ", () => {
    // Simulates: gct_enabled toggled ON in business_parameters AFTER this quote's
    // snapshot was taken — the frozen snapshot (gct_enabled: false) must win.
    const result = computeDepositInvoiceAmounts({
      total_client_jmd: 50000,
      deposit_pct: 50,
      parameters_snapshot: params({ gct_enabled: false, gct_rate_pct: 15 }),
      fx_snapshot: fx(),
    });
    expect(result.gctAmountJmd).toBe(0);
  });

  it("derives an informational USD equivalent from the quote's own effective_rate", () => {
    const result = computeDepositInvoiceAmounts({
      total_client_jmd: 100000,
      deposit_pct: 60,
      parameters_snapshot: params({ gct_enabled: true, gct_rate_pct: 15 }),
      fx_snapshot: fx({ effective_rate: 166.86 }),
    });
    // 69000 / 166.86 = 413.5227...
    expect(result.amountUsd).toBe(413.52);
  });

  it("handles a null total_client_jmd defensively (quote not yet computed)", () => {
    const result = computeDepositInvoiceAmounts({
      total_client_jmd: null,
      deposit_pct: 60,
      parameters_snapshot: params(),
      fx_snapshot: fx(),
    });
    expect(result.subtotalJmd).toBe(0);
    expect(result.amountJmd).toBe(0);
  });
});

describe("computeBalanceInvoiceAmounts", () => {
  it("subtracts the deposit invoice's OWN stored subtotal from the quote total", () => {
    const deposit = computeDepositInvoiceAmounts({
      total_client_jmd: 100000,
      deposit_pct: 60,
      parameters_snapshot: params({ gct_enabled: true, gct_rate_pct: 15 }),
      fx_snapshot: fx(),
    });
    const balance = computeBalanceInvoiceAmounts(
      {
        total_client_jmd: 100000,
        parameters_snapshot: params({ gct_enabled: true, gct_rate_pct: 15 }),
        fx_snapshot: fx(),
      },
      deposit.subtotalJmd,
    );
    expect(balance.subtotalJmd).toBe(40000);
    expect(balance.gctAmountJmd).toBe(6000);
    expect(balance.amountJmd).toBe(46000);
    // Deposit + balance subtotals reconstruct the quote total exactly.
    expect(deposit.subtotalJmd + balance.subtotalJmd).toBe(100000);
  });

  it("sums back to the quote total cent-for-cent even with an odd total that doesn't divide evenly", () => {
    const total = 99999.99;
    const deposit = computeDepositInvoiceAmounts({
      total_client_jmd: total,
      deposit_pct: 60,
      parameters_snapshot: params({ gct_enabled: false }),
      fx_snapshot: fx(),
    });
    const balance = computeBalanceInvoiceAmounts(
      { total_client_jmd: total, parameters_snapshot: params({ gct_enabled: false }), fx_snapshot: fx() },
      deposit.subtotalJmd,
    );
    const sum = Math.round((deposit.subtotalJmd + balance.subtotalJmd) * 100) / 100;
    expect(sum).toBe(total);
  });

  it("applies GCT using the same frozen snapshot the deposit invoice used", () => {
    const balance = computeBalanceInvoiceAmounts(
      {
        total_client_jmd: 100000,
        parameters_snapshot: params({ gct_enabled: true, gct_rate_pct: 15 }),
        fx_snapshot: fx(),
      },
      60000,
    );
    expect(balance.gctAmountJmd).toBe(6000);
  });
});

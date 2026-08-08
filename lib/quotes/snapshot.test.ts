/**
 * Snapshot builders — the "an incomplete parameter read is a HARD ERROR" rule
 * (security review 2026-08-08, BLOCKER-3b).
 *
 * The bug these lock down: `buildParametersSnapshot([])` used to return a
 * perfectly well-formed snapshot made entirely of hard-coded seed defaults, and
 * that snapshot was then written into `quotes.parameters_snapshot` where it
 * priced the quote forever. Nothing anywhere reported a problem. Under RLS a
 * denied SELECT returns zero rows with `error === null`, so every `if (error)`
 * guard in the app sailed straight past it — but a transient partial read would
 * have done the same damage to a FOUNDER's quote, which is why this is fixed in
 * the builders themselves and not only in the callers.
 */

import { describe, expect, it } from "vitest";
import type { BusinessParameterRow } from "@/lib/supabase/types";
import {
  ALL_SNAPSHOT_KEYS,
  MissingBusinessParametersError,
  SNAPSHOT_FX_KEYS,
  SNAPSHOT_PARAMETER_KEYS,
  buildFxSnapshot,
  buildParametersSnapshot,
} from "./snapshot";

function param(
  key: string,
  value: unknown,
  value_type: BusinessParameterRow["value_type"] = "numeric",
): BusinessParameterRow {
  return {
    id: key,
    key,
    value: { type: value_type === "percent" ? "numeric" : value_type, value } as never,
    value_type,
    description: null,
    updated_by: null,
    updated_at: "2026-08-08T00:00:00Z",
    created_at: "2026-08-08T00:00:00Z",
  };
}

/** The full seeded set, matching 20260713000003_seed_parameters.sql. */
function seedParams(): BusinessParameterRow[] {
  return [
    param("duty_gct_pct", 55, "percent"),
    param("marine_insurance_pct", 1.5, "percent"),
    param("brokerage_first_pallet_usd", 120),
    param("brokerage_addl_pallet_usd", 50),
    param("port_handling_usd", 50),
    param("freight_insurance_fallback_usd", 1250),
    param("procurement_handling_fee_usd", 500),
    param("contingency_pct", 5, "percent"),
    param("margin_tiers", [30, 35, 40], "table"),
    param("margin_floor_pct", 20, "percent"),
    param("min_order_value_usd", 2000),
    param("deposit_standard_pct", 60, "percent"),
    param("quote_validity_days", 15),
    param("default_finish", "Satin Stainless Steel (US32D)", "text"),
    param("gct_enabled", false, "boolean"),
    param("gct_rate_pct", 15, "percent"),
    param("lead_times", { UK: "4-8 weeks" }, "table"),
    param("company_details", { name: "Veridan Limited" }, "table"),
    param("fx_bank_sell_rate_usd_jmd", 162),
    param("fx_risk_buffer_pct", 3, "percent"),
    param("supplier_fx_rates", { USD: 1, GBP: 1.27 }, "table"),
  ];
}

describe("required-key lists", () => {
  it("covers every key public.snapshot_business_parameters() returns", () => {
    // If these drift apart, a quote silently loses an input (before this fix) or
    // becomes uncreatable (after it). Both are worth failing a test over.
    expect([...ALL_SNAPSHOT_KEYS].sort()).toEqual(
      seedParams()
        .map((r) => r.key)
        .sort(),
    );
  });

  it("splits cleanly into the parameter half and the FX half", () => {
    expect(SNAPSHOT_PARAMETER_KEYS).toHaveLength(18);
    expect(SNAPSHOT_FX_KEYS).toHaveLength(3);
    const overlap = SNAPSHOT_PARAMETER_KEYS.filter((k) =>
      (SNAPSHOT_FX_KEYS as readonly string[]).includes(k),
    );
    expect(overlap).toEqual([]);
  });
});

describe("buildParametersSnapshot refuses an incomplete parameter set", () => {
  it("THROWS on an empty set — the RLS-denied shape", () => {
    // This is the exact call the three quote-creation paths used to make with a
    // staff session's zero-row result.
    expect(() => buildParametersSnapshot([])).toThrow(MissingBusinessParametersError);
  });

  it("THROWS rather than substituting seed defaults for a short set", () => {
    expect(() => buildParametersSnapshot([param("duty_gct_pct", 55, "percent")])).toThrow(
      MissingBusinessParametersError,
    );
  });

  it("names every missing key so the failure is actionable", () => {
    const withoutTwo = seedParams().filter(
      (r) => r.key !== "margin_floor_pct" && r.key !== "quote_validity_days",
    );
    try {
      buildParametersSnapshot(withoutTwo);
      throw new Error("expected buildParametersSnapshot to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingBusinessParametersError);
      const e = err as MissingBusinessParametersError;
      expect(e.missingKeys).toEqual(["margin_floor_pct", "quote_validity_days"]);
      expect(e.message).toContain("margin_floor_pct");
      expect(e.message).toContain("quote_validity_days");
      // The message must point at the two real causes, since those are the two
      // things the person reading it has to check.
      expect(e.message).toContain("seed_parameters");
      expect(e.message).toContain("snapshot_business_parameters");
    }
  });

  it("treats a present-but-null value as missing (it would hit the same default)", () => {
    const nulled = seedParams().map((r) =>
      r.key === "margin_tiers" ? param("margin_tiers", null, "table") : r,
    );
    expect(() => buildParametersSnapshot(nulled)).toThrow(/margin_tiers/);
  });

  it("does NOT treat a legitimately falsy value as missing", () => {
    // gct_enabled is seeded as `false`. A naive truthiness check here would make
    // every quote uncreatable on a correctly-seeded database.
    const snapshot = buildParametersSnapshot(seedParams());
    expect(snapshot.gct_enabled).toBe(false);
  });

  it("still builds normally from the full seeded set", () => {
    const snapshot = buildParametersSnapshot(seedParams());
    expect(snapshot.duty_gct_pct).toBe(55);
    expect(snapshot.margin_tiers).toEqual([30, 35, 40]);
    expect(snapshot.default_finish).toContain("Satin Stainless Steel");
  });
});

describe("buildFxSnapshot refuses an incomplete FX set", () => {
  it("THROWS on an empty set instead of freezing 162 JMD/USD + 3%", () => {
    expect(() => buildFxSnapshot([], "2026-08-08")).toThrow(MissingBusinessParametersError);
  });

  it("THROWS when only some FX keys came back", () => {
    expect(() =>
      buildFxSnapshot([param("fx_bank_sell_rate_usd_jmd", 162)], "2026-08-08"),
    ).toThrow(/fx_risk_buffer_pct/);
  });

  it("accepts the three-key FX-only read that refreshFxSnapshot performs", () => {
    // refreshFxSnapshot selects exactly these keys, so the FX guard must not
    // demand the non-FX parameters.
    const fxOnly = seedParams().filter((r) =>
      (SNAPSHOT_FX_KEYS as readonly string[]).includes(r.key),
    );
    const fx = buildFxSnapshot(fxOnly, "2026-08-08");
    expect(fx.bank_sell_rate).toBe(162);
    expect(fx.fx_buffer_pct).toBe(3);
    expect(fx.effective_rate).toBeCloseTo(166.86, 10);
    expect(fx.as_of).toBe("2026-08-08");
  });
});

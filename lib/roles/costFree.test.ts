/**
 * The server→client cost boundary (security review 2026-08-08, BLOCKER-1).
 *
 * Two kinds of assertion here, deliberately:
 *
 *   1. RUNTIME — build the exact objects the server hands to `ProductListItem`
 *      and `QuoteLineRow` for a STAFF viewer, serialise them the way React
 *      serialises Client Component props into the RSC flight payload, and assert
 *      that no cost field and no cost VALUE survives. This is the closest a unit
 *      test can get to "press Ctrl-U and search for unit_cost".
 *
 *   2. COMPILE-TIME — `@ts-expect-error` lines asserting that handing a raw
 *      database row to those components does not typecheck. Vitest strips types
 *      and cannot see these; `npx tsc --noEmit` does, and FAILS if the error it
 *      is told to expect does not occur. So the narrowing is verified by the
 *      typecheck step, and this file is where the intent is written down.
 */

import { describe, expect, it } from "vitest";
import { COST_FIELD_NAMES, assertCostFree, findCostFields } from "./costFree";
// Relative, not "@/…": vitest resolves no path alias in this repo, and these
// two are VALUE imports (the mappers), not type-only ones that would be erased.
import {
  toProductListItemView,
  type ProductListItemView,
  type ProductListSourceRow,
} from "../../app/admin/products/productView";
import {
  toQuoteLineRowView,
  type QuoteLineRowView,
} from "../../app/admin/quotes/[id]/quoteLineView";
import type { ProductWithSupplier, QuoteLineItemWithDetails } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Fixtures: full rows exactly as `select("*")` returns them, cost columns and
// all. These are what USED to be passed straight through as props.
// ---------------------------------------------------------------------------

const FULL_PRODUCT: ProductWithSupplier = {
  id: "p1",
  generic_category: "locksets",
  description: "Mortice lock, 5-lever",
  catalogue_ref: "ML-5L",
  specified_finish: "Satin",
  supplied_finish: "Satin Stainless",
  manufacturer: "Assa Abloy",
  product_ref: "AA-1234",
  supplier_id: "s1",
  unit: "each",
  unit_cost: 187.4213,
  cost_currency: "GBP",
  source: "manual",
  active: true,
  item_group_id: "g1",
  finish_code: "US32D",
  design_series: "Series 9",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  suppliers: { id: "s1", name: "Consort Hardware Ltd" },
  item_groups: { id: "g1", family_name: "Mortice locks", grade: "Grade 1" },
};

const FULL_QUOTE_LINE: QuoteLineItemWithDetails = {
  id: "l1",
  quote_id: "q1",
  door_id: "d1",
  hardware_set_id: "hs1",
  product_id: "p1",
  supplier_id: "s1",
  quote_origin_id: "o1",
  description_override: null,
  qty: 4,
  unit_cost: 187.4213,
  cost_currency: "GBP",
  unit_cost_usd: 238.025,
  line_value_usd: 952.1,
  allocated_shipment_cost_usd: 311.44,
  landed_cost_usd: 1263.54,
  margin_pct_override: 22.5,
  sort_order: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  products: {
    id: "p1",
    description: "Mortice lock, 5-lever",
    manufacturer: "Assa Abloy",
    product_ref: "AA-1234",
    unit: "each",
  },
  doors: { id: "d1", door_number: "D-101", floor: "Ground" },
  hardware_sets: { id: "hs1", code: "HS-01", name: "Entrance set" },
  suppliers: { id: "s1", name: "Consort Hardware Ltd" },
};

/** Every distinct cost NUMBER in the fixtures, as it would appear in JSON. */
const COST_VALUES = [
  "187.4213",
  "238.025",
  "952.1",
  "311.44",
  "1263.54",
  "22.5",
  '"GBP"',
];

// ---------------------------------------------------------------------------
// findCostFields / assertCostFree
// ---------------------------------------------------------------------------

describe("findCostFields", () => {
  it("finds a cost field at the top level", () => {
    expect(findCostFields({ unit_cost: 1 })).toEqual(["props.unit_cost"]);
  });

  it("finds one buried inside a nested row — the realistic leak", () => {
    const leaky = { line: { id: "l1", products: { unit_cost: 5 } } };
    expect(findCostFields(leaky)).toEqual(["props.line.products.unit_cost"]);
  });

  it("finds them inside arrays", () => {
    expect(findCostFields({ rows: [{ id: "a" }, { landed_cost_usd: 3 }] })).toEqual([
      "props.rows[1].landed_cost_usd",
    ]);
  });

  it("reports every leak, not just the first", () => {
    expect(findCostFields(FULL_QUOTE_LINE).length).toBeGreaterThanOrEqual(6);
  });

  it("survives a cyclic object rather than hanging", () => {
    const cyclic: Record<string, unknown> = { id: "x" };
    cyclic.self = cyclic;
    expect(findCostFields(cyclic)).toEqual([]);
  });

  it("does NOT flag client-price fields — those are staff work", () => {
    expect(
      findCostFields({ clientPriceUsd: 1200, clientPriceJmd: 200000, total_client_usd: 1200 }),
    ).toEqual([]);
  });

  it("assertCostFree names the offending path", () => {
    expect(() => assertCostFree({ line: { unit_cost: 1 } }, "QuoteLineRow props")).toThrow(
      /QuoteLineRow props\.line\.unit_cost/,
    );
  });

  it("catches the pre-fix props object, proving the test would have failed then", () => {
    // This is literally what the old code passed:
    //   <QuoteLineRow line={line} suppliers={suppliers} landedCostUsd={null} showCosts={false} />
    // The nulled `landedCostUsd` prop was beside the point — the value rode
    // along inside `line`.
    const oldStaffProps = { line: FULL_QUOTE_LINE, landedCostUsd: null, showCosts: false };
    expect(() => assertCostFree(oldStaffProps)).toThrow();
    expect(findCostFields(oldStaffProps)).toContain("props.line.landed_cost_usd");
    expect(findCostFields(oldStaffProps)).toContain("props.line.unit_cost");
  });
});

// ---------------------------------------------------------------------------
// The DTOs actually shipped to a staff browser
// ---------------------------------------------------------------------------

/** What React serialises: JSON, at any depth, is what lands in `self.__next_f`. */
function flightPayload(props: unknown): string {
  return JSON.stringify(props);
}

describe("ProductListItem props for a STAFF viewer", () => {
  // The staff query selects STAFF_PRODUCT_COLUMNS — no unit_cost, no
  // cost_currency, no suppliers embed. Modelled here as the same full row with
  // those columns absent, so the test is honest about what the server holds.
  const staffRow: ProductListSourceRow = {
    id: FULL_PRODUCT.id,
    description: FULL_PRODUCT.description,
    generic_category: FULL_PRODUCT.generic_category,
    manufacturer: FULL_PRODUCT.manufacturer,
    product_ref: FULL_PRODUCT.product_ref,
    catalogue_ref: FULL_PRODUCT.catalogue_ref,
    unit: FULL_PRODUCT.unit,
    active: FULL_PRODUCT.active,
    item_group_id: FULL_PRODUCT.item_group_id,
    finish_code: FULL_PRODUCT.finish_code,
    design_series: FULL_PRODUCT.design_series,
    item_groups: FULL_PRODUCT.item_groups,
  };

  const staffProps = { product: toProductListItemView(staffRow), costs: null };

  it("carries no cost field at any depth", () => {
    expect(findCostFields(staffProps)).toEqual([]);
    expect(() => assertCostFree(staffProps, "ProductListItem props")).not.toThrow();
  });

  it("leaks no cost VALUE into the flight payload, by name or by number", () => {
    const payload = flightPayload(staffProps);
    for (const name of COST_FIELD_NAMES) expect(payload).not.toContain(name);
    for (const value of COST_VALUES) expect(payload).not.toContain(value);
  });

  it("does not leak the founder-only supplier identity either", () => {
    expect(flightPayload(staffProps)).not.toContain("Consort Hardware");
    expect(staffProps.product.supplierName).toBeNull();
  });

  it("still carries everything staff legitimately need", () => {
    expect(staffProps.product.description).toBe("Mortice lock, 5-lever");
    expect(staffProps.product.manufacturer).toBe("Assa Abloy");
    expect(staffProps.product.catalogueRef).toBe("ML-5L");
    expect(staffProps.product.unit).toBe("each");
    expect(staffProps.product.itemGroupLabel).toBe("Mortice locks (Grade 1)");
  });

  it("would ALSO be clean if a founder-shaped row reached the mapper", () => {
    // Defence in depth: even handed the full row (cost columns and all), the
    // mapper cannot copy a cost across, because the target type has nowhere to
    // put one. The narrowed query and the mapper are independent protections.
    const fromFullRow = toProductListItemView(FULL_PRODUCT as ProductListSourceRow);
    expect(findCostFields({ product: fromFullRow })).toEqual([]);
    expect(flightPayload(fromFullRow)).not.toContain("187.4213");
  });
});

describe("QuoteLineRow props for a STAFF viewer", () => {
  const staffProps = {
    quoteId: "q1",
    line: toQuoteLineRowView(FULL_QUOTE_LINE, 1687.32, 281_500, { includeSupplierName: false }),
    isDraft: true,
    costs: null,
  };

  it("carries no cost field at any depth", () => {
    expect(findCostFields(staffProps)).toEqual([]);
  });

  it("leaks no cost VALUE into the flight payload", () => {
    const payload = flightPayload(staffProps);
    for (const name of COST_FIELD_NAMES) expect(payload).not.toContain(name);
    for (const value of COST_VALUES) expect(payload).not.toContain(value);
  });

  it("drops landed_cost_usd specifically — the field the old code half-hid", () => {
    expect(flightPayload(staffProps)).not.toContain("1263.54");
  });

  it("keeps the CLIENT prices, which staff are meant to see", () => {
    expect(staffProps.line.clientPriceUsd).toBe(1687.32);
    expect(staffProps.line.clientPriceJmd).toBe(281_500);
    expect(staffProps.line.label).toBe("Mortice lock, 5-lever");
    expect(staffProps.line.qty).toBe(4);
    expect(staffProps.line.isAdHoc).toBe(false);
  });

  it("labels an ad-hoc line from its own text", () => {
    const adHoc = toQuoteLineRowView(
      { ...FULL_QUOTE_LINE, product_id: null, products: null, description_override: "Site survey" },
      null,
      null,
      { includeSupplierName: false },
    );
    expect(adHoc.label).toBe("Site survey");
    expect(adHoc.isAdHoc).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compile-time narrowing. Verified by `npx tsc --noEmit`, which fails with
// TS2578 ("unused directive") if any of the expected-error lines below stops
// being an error — i.e. if someone widens a DTO back out.
// ---------------------------------------------------------------------------

describe("compile-time narrowing (checked by tsc, not by vitest)", () => {
  it("documents that a raw row cannot be used as a client DTO", () => {
    // @ts-expect-error — a full products row is not a ProductListItemView: it
    // carries unit_cost/cost_currency, which the view type forbids outright.
    const bad: ProductListItemView = FULL_PRODUCT;

    // @ts-expect-error — same for a quote line row.
    const alsoBad: QuoteLineRowView = FULL_QUOTE_LINE;

    const sneaked: ProductListItemView = {
      ...toProductListItemView(FULL_PRODUCT as ProductListSourceRow),
      // @ts-expect-error — and a cost field cannot be bolted onto a view: the
      // `?: never` guard in NoCostFields makes `number` unassignable.
      unit_cost: 187.4213,
    };

    // Referenced so `noUnusedLocals`-style rules stay happy; the assertions that
    // matter are the three above, enforced at typecheck time.
    expect([bad, alsoBad, sneaked]).toHaveLength(3);
  });
});

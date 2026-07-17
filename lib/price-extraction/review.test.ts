import { describe, expect, it } from "vitest";
import {
  buildSeedQuoteLineDrafts,
  checkAcceptAllowed,
  classifyMatchKind,
  computeUploadProgress,
  confidencePercentLabel,
  confidenceTier,
  formatRawExtractedText,
  isResolvedStatus,
  resolveAcceptedStatus,
  selectBulkAcceptableRowIds,
} from "./review";

describe("classifyMatchKind", () => {
  it("existing_product when matched_product_id is set", () => {
    expect(classifyMatchKind({ matched_product_id: "p1", item_group_match_id: null })).toBe(
      "existing_product"
    );
  });
  it("item_group when only item_group_match_id is set", () => {
    expect(classifyMatchKind({ matched_product_id: null, item_group_match_id: "g1" })).toBe(
      "item_group"
    );
  });
  it("matched_product_id wins if somehow both are set", () => {
    expect(classifyMatchKind({ matched_product_id: "p1", item_group_match_id: "g1" })).toBe(
      "existing_product"
    );
  });
  it("new_item when neither is set", () => {
    expect(classifyMatchKind({ matched_product_id: null, item_group_match_id: null })).toBe("new_item");
  });
});

describe("isResolvedStatus", () => {
  it("accepted/edited/rejected are resolved", () => {
    expect(isResolvedStatus("accepted")).toBe(true);
    expect(isResolvedStatus("edited")).toBe(true);
    expect(isResolvedStatus("rejected")).toBe(true);
  });
  it("confident/needs_review are not resolved", () => {
    expect(isResolvedStatus("confident")).toBe(false);
    expect(isResolvedStatus("needs_review")).toBe(false);
  });
});

describe("computeUploadProgress", () => {
  it("empty upload is not complete", () => {
    const p = computeUploadProgress([]);
    expect(p.total).toBe(0);
    expect(p.isComplete).toBe(false);
  });
  it("counts each bucket and flags complete only when every row is resolved", () => {
    const p = computeUploadProgress(["accepted", "edited", "rejected", "needs_review"]);
    expect(p).toMatchObject({ total: 4, accepted: 1, edited: 1, rejected: 1, resolved: 3, remaining: 1 });
    expect(p.isComplete).toBe(false);
  });
  it("complete when every row is accepted/edited/rejected", () => {
    const p = computeUploadProgress(["accepted", "edited", "rejected", "accepted"]);
    expect(p.isComplete).toBe(true);
    expect(p.remaining).toBe(0);
  });
});

describe("checkAcceptAllowed", () => {
  it("blocks when the upload has no supplier yet", () => {
    const result = checkAcceptAllowed({ uploadSupplierId: null, matchKind: "existing_product" });
    expect(result.ok).toBe(false);
  });
  it("allows an existing_product match once a supplier is set, no category needed", () => {
    const result = checkAcceptAllowed({ uploadSupplierId: "s1", matchKind: "existing_product" });
    expect(result.ok).toBe(true);
  });
  it("blocks a new_item accept without a chosen category", () => {
    const result = checkAcceptAllowed({ uploadSupplierId: "s1", matchKind: "new_item" });
    expect(result.ok).toBe(false);
  });
  it("allows a new_item accept once a category is chosen", () => {
    const result = checkAcceptAllowed({
      uploadSupplierId: "s1",
      matchKind: "new_item",
      newItemCategory: "locksets",
    });
    expect(result.ok).toBe(true);
  });
  it("item_group match also requires a category (same as new_item)", () => {
    expect(checkAcceptAllowed({ uploadSupplierId: "s1", matchKind: "item_group" }).ok).toBe(false);
    expect(
      checkAcceptAllowed({ uploadSupplierId: "s1", matchKind: "item_group", newItemCategory: "hinges" }).ok
    ).toBe(true);
  });
});

describe("selectBulkAcceptableRowIds", () => {
  it("only includes confident rows with an existing matched product", () => {
    const rows = [
      { id: "r1", review_status: "confident" as const, matched_product_id: "p1" },
      { id: "r2", review_status: "confident" as const, matched_product_id: null }, // new item — excluded even if confident
      { id: "r3", review_status: "needs_review" as const, matched_product_id: "p3" },
      { id: "r4", review_status: "accepted" as const, matched_product_id: "p4" }, // already resolved
    ];
    expect(selectBulkAcceptableRowIds(rows)).toEqual(["r1"]);
  });
});

describe("resolveAcceptedStatus", () => {
  const original = { description: "Lever handle", unitCost: 10, currency: "USD" as const, qty: 5 };

  it("stays accepted when nothing changed", () => {
    expect(resolveAcceptedStatus(original, { ...original })).toBe("accepted");
  });
  it("becomes edited when the unit cost changed", () => {
    expect(resolveAcceptedStatus(original, { ...original, unitCost: 12 })).toBe("edited");
  });
  it("becomes edited when the description changed", () => {
    expect(resolveAcceptedStatus(original, { ...original, description: "Lever handle, satin" })).toBe(
      "edited"
    );
  });
  it("becomes edited when the currency changed", () => {
    expect(resolveAcceptedStatus(original, { ...original, currency: "CAD" })).toBe("edited");
  });
  it("becomes edited when the qty changed", () => {
    expect(resolveAcceptedStatus(original, { ...original, qty: 6 })).toBe("edited");
  });
});

describe("buildSeedQuoteLineDrafts", () => {
  it("maps accepted rows to quote-line drafts verbatim", () => {
    const rows = [
      { id: "e1", matched_product_id: "p1", proposed_qty: 3, proposed_unit_cost: 25.5, proposed_currency: "USD" as const },
    ];
    expect(buildSeedQuoteLineDrafts(rows, "USD")).toEqual([
      { extractedPriceId: "e1", productId: "p1", qty: 3, unitCost: 25.5, currency: "USD" },
    ]);
  });
  it("defaults qty to 1 when proposed_qty is missing or non-positive", () => {
    const rows = [
      { id: "e1", matched_product_id: "p1", proposed_qty: null, proposed_unit_cost: 10, proposed_currency: "USD" as const },
      { id: "e2", matched_product_id: "p2", proposed_qty: 0, proposed_unit_cost: 10, proposed_currency: "USD" as const },
      { id: "e3", matched_product_id: "p3", proposed_qty: -2, proposed_unit_cost: 10, proposed_currency: "USD" as const },
    ];
    const drafts = buildSeedQuoteLineDrafts(rows, "USD");
    expect(drafts.map((d) => d.qty)).toEqual([1, 1, 1]);
  });
  it("falls back to unit cost 0 and the fallback currency when missing", () => {
    const rows = [{ id: "e1", matched_product_id: "p1", proposed_qty: 1, proposed_unit_cost: null, proposed_currency: null }];
    expect(buildSeedQuoteLineDrafts(rows, "JMD")).toEqual([
      { extractedPriceId: "e1", productId: "p1", qty: 1, unitCost: 0, currency: "JMD" },
    ]);
  });
  it("skips rows with no resolved product id", () => {
    const rows = [
      { id: "e1", matched_product_id: null, proposed_qty: 1, proposed_unit_cost: 10, proposed_currency: "USD" as const },
    ];
    expect(buildSeedQuoteLineDrafts(rows, "USD")).toEqual([]);
  });
});

describe("formatRawExtractedText", () => {
  it("renders the extract.ts rawLineJson envelope readably", () => {
    const raw = {
      line: { raw_description: "Lever lockset, satin", product_ref_guess: "LL-100", qty: 10, unit_price: 45, currency: "USD" },
      quote_metadata: { quote_ref: "Q-1", quote_date: "2026-07-01", currency: "USD", validity_text: null },
    };
    expect(formatRawExtractedText(raw)).toBe(
      "Lever lockset, satin · Ref: LL-100 · Qty: 10 · Price: 45 USD"
    );
  });
  it("handles null gracefully", () => {
    expect(formatRawExtractedText(null)).toBe("—");
  });
  it("falls back to JSON for an unexpected shape", () => {
    expect(formatRawExtractedText({ foo: "bar" })).toBe('{"foo":"bar"}');
  });
});

describe("confidenceTier / confidencePercentLabel", () => {
  it("tiers scores as high/medium/low/unknown", () => {
    expect(confidenceTier(0.95)).toBe("high");
    expect(confidenceTier(0.6)).toBe("medium");
    expect(confidenceTier(0.2)).toBe("low");
    expect(confidenceTier(null)).toBe("unknown");
  });
  it("formats a percent label", () => {
    expect(confidencePercentLabel(0.855)).toBe("86%");
    expect(confidencePercentLabel(null)).toBe("—");
  });
});

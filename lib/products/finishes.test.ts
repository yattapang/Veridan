import { describe, expect, it } from "vitest";
import { collectDistinctFinishValues } from "./finishes";

describe("collectDistinctFinishValues", () => {
  it("collects distinct, sorted, non-blank values per finish column", () => {
    const result = collectDistinctFinishValues([
      { specified_finish: "Satin Stainless Steel", supplied_finish: "Satin Stainless Steel", finish_code: "US32D" },
      { specified_finish: "Satin Chrome", supplied_finish: null, finish_code: "US26D" },
      { specified_finish: "Satin Stainless Steel", supplied_finish: "Satin Chrome", finish_code: "US32D" },
    ]);
    expect(result).toEqual({
      specifiedFinishes: ["Satin Chrome", "Satin Stainless Steel"],
      suppliedFinishes: ["Satin Chrome", "Satin Stainless Steel"],
      finishCodes: ["US26D", "US32D"],
    });
  });

  it("ignores null and blank/whitespace-only values", () => {
    const result = collectDistinctFinishValues([
      { specified_finish: null, supplied_finish: "", finish_code: "   " },
      { specified_finish: "  ", supplied_finish: null, finish_code: null },
    ]);
    expect(result).toEqual({ specifiedFinishes: [], suppliedFinishes: [], finishCodes: [] });
  });

  it("trims surrounding whitespace before deduping", () => {
    const result = collectDistinctFinishValues([
      { specified_finish: "US32D ", supplied_finish: null, finish_code: null },
      { specified_finish: " US32D", supplied_finish: null, finish_code: null },
    ]);
    expect(result.specifiedFinishes).toEqual(["US32D"]);
  });

  it("returns empty arrays for an empty product list", () => {
    expect(collectDistinctFinishValues([])).toEqual({
      specifiedFinishes: [],
      suppliedFinishes: [],
      finishCodes: [],
    });
  });
});

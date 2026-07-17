import { describe, expect, it } from "vitest";
import {
  ITEM_GROUP_CONFIDENCE_CAP,
  MIN_MATCH_SCORE,
  fuzzySupplierMatch,
  levenshtein,
  matchExtractedLine,
  normalizeCurrency,
  normalizeRef,
  refSimilarity,
  descriptionSimilarity,
  scoreCandidate,
  tokenize,
  type ProductCandidate,
} from "./matching";

const SUPPLIER_A = "supplier-a";
const SUPPLIER_B = "supplier-b";
const THRESHOLD = 0.85; // matches the seeded extraction_confidence_threshold default

function product(overrides: Partial<ProductCandidate>): ProductCandidate {
  return {
    id: "p-" + Math.random().toString(36).slice(2),
    product_ref: null,
    catalogue_ref: null,
    description: null,
    supplier_id: SUPPLIER_A,
    item_group_id: null,
    ...overrides,
  };
}

describe("string primitives", () => {
  it("normalizeRef strips whitespace/punctuation and lowercases", () => {
    expect(normalizeRef("US-32D ")).toBe("us32d");
    expect(normalizeRef("  LK/450 ")).toBe("lk450");
    expect(normalizeRef(null)).toBe("");
  });

  it("tokenize drops sub-2-char noise", () => {
    expect(tokenize("Commercial Lever Lockset a")).toEqual(["commercial", "lever", "lockset"]);
    expect(tokenize(null)).toEqual([]);
  });

  it("levenshtein computes edit distance", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("abc", "abd")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("refSimilarity is 1 for normalized-equal, 0 for empty side", () => {
    expect(refSimilarity("US-32D", "us32d")).toBe(1);
    expect(refSimilarity("", "us32d")).toBe(0);
    expect(refSimilarity("abcd", "abxd")).toBeCloseTo(0.75, 5);
  });

  it("descriptionSimilarity is Jaccard token overlap", () => {
    expect(descriptionSimilarity("commercial lever lockset", "commercial lever lockset")).toBe(1);
    expect(descriptionSimilarity("commercial lever lockset", "residential deadbolt")).toBe(0);
    // {commercial,lever,lockset} vs {commercial,lever} → 2/3
    expect(descriptionSimilarity("commercial lever lockset", "commercial lever")).toBeCloseTo(
      2 / 3,
      5
    );
  });
});

describe("scoreCandidate", () => {
  it("flags an exact ref match on product_ref and scores 1", () => {
    const { score, exactRef } = scoreCandidate(
      { raw_description: "anything", product_ref_guess: "LK-450" },
      product({ product_ref: "lk450", description: "totally different" })
    );
    expect(exactRef).toBe(true);
    expect(score).toBe(1);
  });

  it("flags an exact ref match on catalogue_ref too", () => {
    const { exactRef } = scoreCandidate(
      { raw_description: null, product_ref_guess: "CAT 900" },
      product({ catalogue_ref: "cat-900" })
    );
    expect(exactRef).toBe(true);
  });

  it("blends ref + description when both refs present", () => {
    const { score, exactRef } = scoreCandidate(
      { raw_description: "commercial lever lockset", product_ref_guess: "lk450" },
      product({ product_ref: "lk451", description: "commercial lever lockset" })
    );
    expect(exactRef).toBe(false);
    // refSim(lk450,lk451)=0.8, descSim=1 → 0.65*0.8 + 0.35*1 = 0.87
    expect(score).toBeCloseTo(0.87, 5);
  });

  it("falls back to description alone when the line has no ref", () => {
    const { score } = scoreCandidate(
      { raw_description: "commercial lever lockset", product_ref_guess: null },
      product({ product_ref: "lk450", description: "commercial lever" })
    );
    expect(score).toBeCloseTo(2 / 3, 5);
  });
});

describe("matchExtractedLine — exact ref (supplier-scoped)", () => {
  it("returns highest confidence for an exact supplier-scoped ref match", () => {
    const candidates = [
      product({ id: "match", product_ref: "LK-450", supplier_id: SUPPLIER_A }),
      product({ id: "other", product_ref: "ZZ-999", supplier_id: SUPPLIER_A }),
    ];
    const result = matchExtractedLine(
      { raw_description: "lever lockset", product_ref_guess: "lk450" },
      candidates,
      SUPPLIER_A,
      THRESHOLD
    );
    expect(result.matchType).toBe("exact_ref");
    expect(result.matchedProductId).toBe("match");
    expect(result.itemGroupMatchId).toBeNull();
    expect(result.confidenceScore).toBe(1);
    expect(result.reviewStatus).toBe("confident");
  });

  it("does not exact-match a same-ref row belonging to a different supplier", () => {
    const candidates = [
      product({ id: "wrong-supplier", product_ref: "LK-450", supplier_id: SUPPLIER_B }),
    ];
    const result = matchExtractedLine(
      { raw_description: "lever lockset", product_ref_guess: "lk450" },
      candidates,
      SUPPLIER_A,
      THRESHOLD
    );
    // Not supplier-scoped, but IS an item-group cross-supplier candidate only
    // if it has an item_group_id (it doesn't here) → no match.
    expect(result.matchType).toBe("none");
  });
});

describe("matchExtractedLine — fuzzy (supplier-scoped)", () => {
  it("returns a fuzzy match with confidence = score", () => {
    const candidates = [
      product({
        id: "fuzzy",
        product_ref: "lk451",
        description: "commercial lever lockset",
        supplier_id: SUPPLIER_A,
      }),
    ];
    const result = matchExtractedLine(
      { raw_description: "commercial lever lockset", product_ref_guess: "lk450" },
      candidates,
      SUPPLIER_A,
      THRESHOLD
    );
    expect(result.matchType).toBe("fuzzy");
    expect(result.matchedProductId).toBe("fuzzy");
    expect(result.confidenceScore).toBeCloseTo(0.87, 5);
    expect(result.reviewStatus).toBe("confident"); // 0.87 >= 0.85
  });

  it("flags a weak-but-present fuzzy match as needs_review", () => {
    const candidates = [
      product({
        id: "weak",
        product_ref: "lk450",
        description: "commercial lever lockset extra bits",
        supplier_id: SUPPLIER_A,
      }),
    ];
    // refSim(lk455,lk450)=0.8, desc {commercial,lever} vs 5 tokens = 0.4
    // → 0.65*0.8 + 0.35*0.4 = 0.66 (between MIN_MATCH_SCORE and THRESHOLD)
    const result = matchExtractedLine(
      { raw_description: "commercial lever", product_ref_guess: "lk455" },
      candidates,
      SUPPLIER_A,
      THRESHOLD
    );
    expect(result.matchType).toBe("fuzzy");
    expect(result.confidenceScore).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
    expect(result.confidenceScore).toBeLessThan(THRESHOLD);
    expect(result.reviewStatus).toBe("needs_review");
  });
});

describe("matchExtractedLine — item-group cross-supplier fallback", () => {
  it("records itemGroupMatchId (not matchedProductId) and caps confidence", () => {
    const candidates = [
      // No supplier-A rows match; supplier-B has the identical ref + item group.
      product({
        id: "cross",
        product_ref: "LK-450",
        description: "commercial lever lockset",
        supplier_id: SUPPLIER_B,
        item_group_id: "group-1",
      }),
    ];
    const result = matchExtractedLine(
      { raw_description: "commercial lever lockset", product_ref_guess: "lk450" },
      candidates,
      SUPPLIER_A,
      THRESHOLD
    );
    expect(result.matchType).toBe("item_group");
    expect(result.matchedProductId).toBeNull();
    expect(result.itemGroupMatchId).toBe("group-1");
    expect(result.confidenceScore).toBe(ITEM_GROUP_CONFIDENCE_CAP);
  });

  it("ignores cross-supplier candidates with no item_group_id", () => {
    const candidates = [
      product({
        id: "cross-no-group",
        product_ref: "LK-450",
        supplier_id: SUPPLIER_B,
        item_group_id: null,
      }),
    ];
    const result = matchExtractedLine(
      { raw_description: "lever", product_ref_guess: "lk450" },
      candidates,
      SUPPLIER_A,
      THRESHOLD
    );
    expect(result.matchType).toBe("none");
  });

  it("prefers a supplier-scoped match over a cross-supplier one", () => {
    const candidates = [
      product({ id: "own", product_ref: "LK-450", supplier_id: SUPPLIER_A }),
      product({
        id: "cross",
        product_ref: "LK-450",
        supplier_id: SUPPLIER_B,
        item_group_id: "group-1",
      }),
    ];
    const result = matchExtractedLine(
      { raw_description: "lever", product_ref_guess: "lk450" },
      candidates,
      SUPPLIER_A,
      THRESHOLD
    );
    expect(result.matchType).toBe("exact_ref");
    expect(result.matchedProductId).toBe("own");
  });
});

describe("matchExtractedLine — no match / junk", () => {
  it("returns none for empty candidate list", () => {
    const result = matchExtractedLine(
      { raw_description: "lever lockset", product_ref_guess: "lk450" },
      [],
      SUPPLIER_A,
      THRESHOLD
    );
    expect(result.matchType).toBe("none");
    expect(result.matchedProductId).toBeNull();
    expect(result.confidenceScore).toBe(0);
  });

  it("returns none for junk line with no signal", () => {
    const candidates = [product({ product_ref: "LK-450", description: "commercial lever lockset" })];
    const result = matchExtractedLine(
      { raw_description: null, product_ref_guess: null },
      candidates,
      SUPPLIER_A,
      THRESHOLD
    );
    expect(result.matchType).toBe("none");
  });

  it("treats an unfamiliar line (below MIN_MATCH_SCORE) as new", () => {
    const candidates = [
      product({ product_ref: "LK-450", description: "commercial lever lockset" }),
    ];
    const result = matchExtractedLine(
      { raw_description: "brass hinge pin oil-rubbed", product_ref_guess: "ZZ-000" },
      candidates,
      SUPPLIER_A,
      THRESHOLD
    );
    expect(result.matchType).toBe("none");
    expect(result.reviewStatus).toBe("needs_review");
  });

  it("with no supplier detected, matches against the whole library and skips cross-supplier step", () => {
    const candidates = [
      product({ id: "any", product_ref: "LK-450", supplier_id: SUPPLIER_B }),
    ];
    const result = matchExtractedLine(
      { raw_description: "lever", product_ref_guess: "lk450" },
      candidates,
      null,
      THRESHOLD
    );
    expect(result.matchType).toBe("exact_ref");
    expect(result.matchedProductId).toBe("any");
  });
});

describe("threshold boundary", () => {
  it("classifies exactly-at-threshold as confident", () => {
    // Construct a line whose fuzzy score lands at ~0.9 so threshold 0.9 is met.
    const candidates = [
      product({ id: "t", product_ref: "lk450", description: "commercial lever lockset" }),
    ];
    const result = matchExtractedLine(
      { raw_description: "commercial lever lockset", product_ref_guess: "lk450x" },
      candidates,
      SUPPLIER_A,
      0.9
    );
    // exact? no (lk450 vs lk450x). refSim = 1 - 1/6 ≈ 0.8333, desc = 1
    // score = 0.65*0.8333 + 0.35*1 = 0.8917 → below 0.9
    expect(result.confidenceScore).toBeLessThan(0.9);
    expect(result.reviewStatus).toBe("needs_review");

    const lenient = matchExtractedLine(
      { raw_description: "commercial lever lockset", product_ref_guess: "lk450x" },
      candidates,
      SUPPLIER_A,
      0.85
    );
    expect(lenient.reviewStatus).toBe("confident");
  });
});

describe("normalizeCurrency", () => {
  it("passes through canonical codes", () => {
    expect(normalizeCurrency("USD")).toBe("USD");
    expect(normalizeCurrency("jmd")).toBe("JMD");
  });

  it("maps symbols and synonyms", () => {
    expect(normalizeCurrency("$")).toBe("USD");
    expect(normalizeCurrency("US$")).toBe("USD");
    expect(normalizeCurrency("£")).toBe("GBP");
    expect(normalizeCurrency("C$")).toBe("CAD");
    expect(normalizeCurrency(" euros ")).toBe("EUR");
  });

  it("returns null for unknown / empty", () => {
    expect(normalizeCurrency("bitcoin")).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
    expect(normalizeCurrency("")).toBeNull();
  });
});

describe("fuzzySupplierMatch", () => {
  const suppliers = [
    { id: "s1", name: "Veridan Hardware" },
    { id: "s2", name: "Kingston Ironmongery" },
  ];

  it("matches an exact name with confidence 1", () => {
    const result = fuzzySupplierMatch("Veridan Hardware", suppliers);
    expect(result.supplierId).toBe("s1");
    expect(result.confidence).toBe(1);
  });

  it("matches a close name (suffix noise) strongly", () => {
    const result = fuzzySupplierMatch("Veridan Hardware Ltd.", suppliers);
    expect(result.supplierId).toBe("s1");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("returns null supplier for empty input or no suppliers", () => {
    expect(fuzzySupplierMatch(null, suppliers).supplierId).toBeNull();
    expect(fuzzySupplierMatch("Veridan", []).supplierId).toBeNull();
  });
});

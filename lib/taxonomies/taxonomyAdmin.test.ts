import { describe, expect, it } from "vitest";
import {
  buildTaxonomyOptions,
  computeTaxonomyUsageCounts,
  deriveTaxonomyName,
  usageCountFor,
  validateTaxonomyLabel,
  type TaxonomyNameCandidate,
} from "./taxonomyAdmin";

describe("deriveTaxonomyName", () => {
  it("lowercases and underscore-separates a label", () => {
    expect(deriveTaxonomyName("Facilities Management")).toBe("facilities_management");
    expect(deriveTaxonomyName("Exit devices")).toBe("exit_devices");
  });

  it("strips punctuation", () => {
    expect(deriveTaxonomyName("Access-Control!")).toBe("access_control");
  });

  it("trims leading/trailing underscores produced by stray punctuation", () => {
    expect(deriveTaxonomyName("  -Consultant-  ")).toBe("consultant");
  });

  it("returns an empty string for a label with no letters or numbers", () => {
    expect(deriveTaxonomyName("---")).toBe("");
  });
});

describe("validateTaxonomyLabel", () => {
  const existing: TaxonomyNameCandidate[] = [
    { id: "1", name: "architect", label: "Architect" },
    { id: "2", name: "fm", label: "Facilities Management" },
  ];

  it("rejects a blank/whitespace-only label", () => {
    expect(validateTaxonomyLabel("", existing)).toEqual({ ok: false, error: expect.any(String) });
    expect(validateTaxonomyLabel("   ", existing)).toEqual({ ok: false, error: expect.any(String) });
  });

  it("accepts a new, non-colliding label and derives its stored name", () => {
    const result = validateTaxonomyLabel("Consultant", existing);
    expect(result).toEqual({ ok: true, name: "consultant", label: "Consultant" });
  });

  it("trims surrounding whitespace before validating", () => {
    const result = validateTaxonomyLabel("  Consultant  ", existing);
    expect(result).toEqual({ ok: true, name: "consultant", label: "Consultant" });
  });

  it("rejects a case-insensitive duplicate label with a friendly error naming the collision", () => {
    const result = validateTaxonomyLabel("architect", existing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Architect");
  });

  it("rejects a label that derives the same stored name as an existing entry, even with a different label text", () => {
    // "Fm" derives to "fm", which collides with the existing 'fm' entry's
    // stored name — even though "Fm" and "Facilities Management" are not
    // the same label text (so the label-collision check alone wouldn't
    // catch this; the name-collision check must).
    const result = validateTaxonomyLabel("Fm", existing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("fm");
      expect(result.error).toContain("Facilities Management");
    }
  });

  it("rejects a label that derives to an empty stored name", () => {
    const result = validateTaxonomyLabel("***", existing);
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it("excludes the row being renamed from its own collision check", () => {
    const result = validateTaxonomyLabel("Architect", existing, "1");
    expect(result).toEqual({ ok: true, name: "architect", label: "Architect" });
  });

  it("still catches a collision with a DIFFERENT row during a rename", () => {
    const result = validateTaxonomyLabel("Facilities Management", existing, "1");
    expect(result.ok).toBe(false);
  });
});

describe("computeTaxonomyUsageCounts / usageCountFor", () => {
  it("counts records by exact stored value, ignoring null/blank", () => {
    const counts = computeTaxonomyUsageCounts(["architect", "architect", "owner", null, ""]);
    expect(usageCountFor("architect", counts)).toBe(2);
    expect(usageCountFor("owner", counts)).toBe(1);
    expect(usageCountFor("fm", counts)).toBe(0);
  });

  it("returns 0 for a value nothing uses", () => {
    const counts = computeTaxonomyUsageCounts([]);
    expect(usageCountFor("anything", counts)).toBe(0);
  });
});

describe("buildTaxonomyOptions", () => {
  const managed = [
    { name: "architect", label: "Architect" },
    { name: "fm", label: "Facilities Management" },
  ];

  it("lists every managed entry, none marked custom", () => {
    const options = buildTaxonomyOptions(managed, null);
    expect(options).toEqual([
      { value: "architect", label: "Architect", isCustom: false },
      { value: "fm", label: "Facilities Management", isCustom: false },
    ]);
  });

  it("appends the record's current value as a custom option when it isn't managed", () => {
    const options = buildTaxonomyOptions(managed, "legacy_value");
    expect(options).toHaveLength(3);
    expect(options[2]).toEqual({
      value: "legacy_value",
      label: "legacy_value (custom — not in the managed list)",
      isCustom: true,
    });
  });

  it("does not duplicate a current value that IS already managed", () => {
    const options = buildTaxonomyOptions(managed, "fm");
    expect(options).toHaveLength(2);
  });

  it("adds nothing extra for a null/blank current value", () => {
    expect(buildTaxonomyOptions(managed, null)).toHaveLength(2);
    expect(buildTaxonomyOptions(managed, undefined)).toHaveLength(2);
    expect(buildTaxonomyOptions(managed, "   ")).toHaveLength(2);
  });
});

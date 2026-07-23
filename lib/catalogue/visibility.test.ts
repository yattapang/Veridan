import { describe, expect, it } from "vitest";
import {
  CATALOGUE_RIGHTS_CONFIRMATION_WARNING,
  DEFAULT_CATALOGUE_VISIBILITY,
  isDownloadable,
  isValidCatalogueVisibility,
  nextCatalogueVisibility,
  parseCatalogueVisibility,
  transitionNeedsRightsConfirmation,
} from "./visibility";

describe("DEFAULT_CATALOGUE_VISIBILITY", () => {
  it("is 'internal' — the load-bearing safe default (Plan §3.3)", () => {
    expect(DEFAULT_CATALOGUE_VISIBILITY).toBe("internal");
  });
});

describe("isValidCatalogueVisibility", () => {
  it("accepts 'internal' and 'public'", () => {
    expect(isValidCatalogueVisibility("internal")).toBe(true);
    expect(isValidCatalogueVisibility("public")).toBe(true);
  });

  it("rejects anything else, including near-miss casing or empty values", () => {
    expect(isValidCatalogueVisibility("Public")).toBe(false);
    expect(isValidCatalogueVisibility("")).toBe(false);
    expect(isValidCatalogueVisibility(null)).toBe(false);
    expect(isValidCatalogueVisibility(undefined)).toBe(false);
    expect(isValidCatalogueVisibility(42)).toBe(false);
  });
});

describe("parseCatalogueVisibility — every untrusted-input path must land on the safe default, never 'public'", () => {
  it("passes through a valid value", () => {
    expect(parseCatalogueVisibility("public")).toBe("public");
    expect(parseCatalogueVisibility("internal")).toBe("internal");
  });

  it("falls back to 'internal' for a missing form field", () => {
    expect(parseCatalogueVisibility(undefined)).toBe("internal");
    expect(parseCatalogueVisibility(null)).toBe("internal");
  });

  it("falls back to 'internal' for a blank or malformed value — never silently defaults to 'public'", () => {
    expect(parseCatalogueVisibility("")).toBe("internal");
    expect(parseCatalogueVisibility("PUBLIC")).toBe("internal");
    expect(parseCatalogueVisibility("published")).toBe("internal");
    expect(parseCatalogueVisibility(123)).toBe("internal");
  });
});

describe("isDownloadable — the §3.3 gate", () => {
  it("is true only for visibility = 'public'", () => {
    expect(isDownloadable({ visibility: "public" })).toBe(true);
    expect(isDownloadable({ visibility: "internal" })).toBe(false);
  });
});

describe("nextCatalogueVisibility", () => {
  it("toggles internal -> public and public -> internal", () => {
    expect(nextCatalogueVisibility("internal")).toBe("public");
    expect(nextCatalogueVisibility("public")).toBe("internal");
  });
});

describe("transitionNeedsRightsConfirmation", () => {
  it("requires confirmation only when moving TO public FROM internal", () => {
    expect(transitionNeedsRightsConfirmation("internal", "public")).toBe(true);
  });

  it("never requires confirmation when moving to internal (making something private is always safe)", () => {
    expect(transitionNeedsRightsConfirmation("public", "internal")).toBe(false);
    expect(transitionNeedsRightsConfirmation("internal", "internal")).toBe(false);
  });

  it("does not require confirmation for a public -> public no-op", () => {
    expect(transitionNeedsRightsConfirmation("public", "public")).toBe(false);
  });
});

describe("CATALOGUE_RIGHTS_CONFIRMATION_WARNING", () => {
  it("matches the exact wording required by the brief, so the UI and any confirm dialog stay byte-identical", () => {
    expect(CATALOGUE_RIGHTS_CONFIRMATION_WARNING).toBe(
      "Confirm you are licensed to publish this supplier's catalogue publicly before making it visible."
    );
  });
});

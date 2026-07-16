import { describe, expect, it } from "vitest";
import {
  canEdit,
  canTransition,
  computeValidUntilIso,
  isComputedExpired,
  isPastValidUntil,
  nextRevisionNumber,
  revisionQuoteRef,
} from "./workflow";

describe("canTransition", () => {
  it("allows the happy-path pipeline", () => {
    expect(canTransition("draft", "approved").ok).toBe(true);
    expect(canTransition("approved", "sent").ok).toBe(true);
    expect(canTransition("sent", "accepted").ok).toBe(true);
    expect(canTransition("sent", "declined").ok).toBe(true);
    expect(canTransition("sent", "expired").ok).toBe(true);
  });

  it("allows accept/decline/expire from viewed (Phase 2 status, enum already supports it)", () => {
    expect(canTransition("viewed", "accepted").ok).toBe(true);
    expect(canTransition("viewed", "declined").ok).toBe(true);
    expect(canTransition("viewed", "expired").ok).toBe(true);
  });

  it("rejects skipping stages", () => {
    const r = canTransition("draft", "sent");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/draft/);
    expect(canTransition("draft", "accepted").ok).toBe(false);
    expect(canTransition("approved", "accepted").ok).toBe(false);
  });

  it("rejects going backwards", () => {
    expect(canTransition("approved", "draft").ok).toBe(false);
    expect(canTransition("sent", "approved").ok).toBe(false);
    expect(canTransition("sent", "draft").ok).toBe(false);
  });

  it("rejects any transition out of a terminal status", () => {
    for (const to of ["draft", "approved", "sent", "viewed", "accepted", "declined", "expired"] as const) {
      expect(canTransition("accepted", to).ok).toBe(false);
      expect(canTransition("declined", to).ok).toBe(false);
      expect(canTransition("expired", to).ok).toBe(false);
    }
  });

  it("rejects a no-op transition (status to itself)", () => {
    expect(canTransition("draft", "draft").ok).toBe(false);
    expect(canTransition("sent", "sent").ok).toBe(false);
  });
});

describe("canEdit", () => {
  it("is true only for draft", () => {
    expect(canEdit("draft")).toBe(true);
    for (const status of ["approved", "sent", "viewed", "accepted", "declined", "expired"] as const) {
      expect(canEdit(status)).toBe(false);
    }
  });
});

describe("computeValidUntilIso", () => {
  it("adds validity days using calendar arithmetic", () => {
    expect(computeValidUntilIso("2026-07-01", 15)).toBe("2026-07-16");
  });

  it("crosses month/year boundaries correctly", () => {
    expect(computeValidUntilIso("2026-12-20", 15)).toBe("2027-01-04");
  });

  it("treats a non-finite validity as zero days", () => {
    expect(computeValidUntilIso("2026-07-01", Number.NaN)).toBe("2026-07-01");
  });

  it("returns null for a malformed date", () => {
    expect(computeValidUntilIso("not-a-date", 15)).toBeNull();
  });
});

describe("isPastValidUntil / isComputedExpired", () => {
  it("is not past on the valid-until date itself", () => {
    expect(isPastValidUntil("2026-07-01", 15, "2026-07-16")).toBe(false);
  });

  it("is past the day after the valid-until date", () => {
    expect(isPastValidUntil("2026-07-01", 15, "2026-07-17")).toBe(true);
  });

  it("is not past before the valid-until date", () => {
    expect(isPastValidUntil("2026-07-01", 15, "2026-07-10")).toBe(false);
  });

  it("computed-expired flags a sent quote past its valid-until date", () => {
    expect(isComputedExpired("sent", "2026-07-01", 15, "2026-07-20")).toBe(true);
  });

  it("computed-expired flags a viewed quote past its valid-until date", () => {
    expect(isComputedExpired("viewed", "2026-07-01", 15, "2026-07-20")).toBe(true);
  });

  it("does not flag a sent quote still within validity", () => {
    expect(isComputedExpired("sent", "2026-07-01", 15, "2026-07-05")).toBe(false);
  });

  it("never flags draft or approved quotes, even long past the date", () => {
    expect(isComputedExpired("draft", "2026-01-01", 15, "2026-07-20")).toBe(false);
    expect(isComputedExpired("approved", "2026-01-01", 15, "2026-07-20")).toBe(false);
  });

  it("does not re-flag quotes already at a terminal outcome", () => {
    expect(isComputedExpired("accepted", "2026-01-01", 15, "2026-07-20")).toBe(false);
    expect(isComputedExpired("declined", "2026-01-01", 15, "2026-07-20")).toBe(false);
    expect(isComputedExpired("expired", "2026-01-01", 15, "2026-07-20")).toBe(false);
  });
});

describe("nextRevisionNumber", () => {
  it("increments by one", () => {
    expect(nextRevisionNumber(1)).toBe(2);
    expect(nextRevisionNumber(4)).toBe(5);
  });
});

describe("revisionQuoteRef", () => {
  it("suffixes the base ref with -R<n>", () => {
    expect(revisionQuoteRef("VQ-2026-003", 2)).toBe("VQ-2026-003-R2");
  });

  it("strips an existing -R<n> suffix before re-suffixing (no chaining)", () => {
    expect(revisionQuoteRef("VQ-2026-003-R2", 3)).toBe("VQ-2026-003-R3");
  });

  it("never produces the same ref as its input for a higher revision", () => {
    const ref = revisionQuoteRef("VQ-2026-010", 2);
    expect(ref).not.toBe("VQ-2026-010");
  });
});

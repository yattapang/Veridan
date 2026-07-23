import { describe, expect, it } from "vitest";
import { isWellFormedSlug, nextAvailableSlug, slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates a simple title", () => {
    expect(slugify("Understanding Door Grades")).toBe("understanding-door-grades");
  });

  it("strips diacritics", () => {
    expect(slugify("Café Résumé")).toBe("cafe-resume");
  });

  it("drops apostrophes rather than hyphenating them", () => {
    expect(slugify("Architect's Guide to Fire Doors")).toBe("architects-guide-to-fire-doors");
  });

  it("collapses runs of punctuation into a single hyphen", () => {
    expect(slugify("Locks & Deadbolts: What's the Difference?")).toBe(
      "locks-deadbolts-whats-the-difference"
    );
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  --Hello World--  ")).toBe("hello-world");
  });

  it("falls back to 'article' when nothing sluggable remains", () => {
    expect(slugify("???")).toBe("article");
    expect(slugify("")).toBe("article");
  });

  it("truncates very long titles", () => {
    const long = "word ".repeat(50).trim();
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(96);
    expect(result.endsWith("-")).toBe(false);
  });
});

describe("nextAvailableSlug", () => {
  it("returns the base slug when it's free", () => {
    expect(nextAvailableSlug("fire-safety", [])).toBe("fire-safety");
  });

  it("appends -2 when the base is taken", () => {
    expect(nextAvailableSlug("fire-safety", ["fire-safety"])).toBe("fire-safety-2");
  });

  it("finds the first free numbered variant", () => {
    expect(nextAvailableSlug("fire-safety", ["fire-safety", "fire-safety-2", "fire-safety-3"])).toBe(
      "fire-safety-4"
    );
  });

  it("accepts a Set as well as an array", () => {
    expect(nextAvailableSlug("fire-safety", new Set(["fire-safety"]))).toBe("fire-safety-2");
  });

  it("falls back to 'article' for an empty base", () => {
    expect(nextAvailableSlug("", [])).toBe("article");
  });
});

describe("isWellFormedSlug", () => {
  it("accepts lowercase-hyphenated slugs", () => {
    expect(isWellFormedSlug("fire-safety-2")).toBe(true);
  });

  it("rejects uppercase, spaces, and leading/trailing hyphens", () => {
    expect(isWellFormedSlug("Fire Safety")).toBe(false);
    expect(isWellFormedSlug("-fire-safety")).toBe(false);
    expect(isWellFormedSlug("fire-safety-")).toBe(false);
    expect(isWellFormedSlug("fire--safety")).toBe(false);
  });
});

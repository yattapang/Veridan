import { describe, expect, it } from "vitest";
import { buildLinkedinCaption } from "./linkedin";

describe("buildLinkedinCaption", () => {
  it("includes title, excerpt, and a read-more line with the URL", () => {
    const caption = buildLinkedinCaption({
      title: "Understanding Door Grades",
      excerpt: "A quick primer on ANSI/BHMA grades for Jamaican builders.",
      url: "https://www.veridanlimited.com/articles/understanding-door-grades",
    });
    expect(caption).toBe(
      [
        "Understanding Door Grades",
        "A quick primer on ANSI/BHMA grades for Jamaican builders.",
        "Read more: https://www.veridanlimited.com/articles/understanding-door-grades",
      ].join("\n\n")
    );
  });

  it("omits the excerpt line entirely when there is no excerpt", () => {
    const caption = buildLinkedinCaption({
      title: "Fire Safety Basics",
      excerpt: null,
      url: "https://www.veridanlimited.com/articles/fire-safety-basics",
    });
    expect(caption).toBe(
      "Fire Safety Basics\n\nRead more: https://www.veridanlimited.com/articles/fire-safety-basics"
    );
  });

  it("trims whitespace from title and excerpt", () => {
    const caption = buildLinkedinCaption({
      title: "  Spaced Title  ",
      excerpt: "  Spaced excerpt.  ",
      url: "https://example.com/x",
    });
    expect(caption).toBe("Spaced Title\n\nSpaced excerpt.\n\nRead more: https://example.com/x");
  });

  it("never contains a linkedin.com URL — this is a copy-paste template, not an API call", () => {
    const caption = buildLinkedinCaption({
      title: "Anything",
      excerpt: null,
      url: "https://www.veridanlimited.com/articles/anything",
    });
    expect(caption).not.toMatch(/linkedin\.com/i);
  });
});

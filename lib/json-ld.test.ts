import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "./json-ld";

describe("serializeJsonLd (Phase 3B review B1 XSS fix)", () => {
  it("neutralizes a </script> breakout in a string field", () => {
    const out = serializeJsonLd({ headline: "Locksets </script><script>alert(1)</script>" });
    // No raw '<' or '>' may survive — those are what break out of the script tag.
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out.toLowerCase()).not.toContain("</script");
    // The escaped forms are present instead.
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
  });

  it("escapes ampersands too", () => {
    const out = serializeJsonLd({ x: "a & b" });
    expect(out).not.toContain("&");
    expect(out).toContain("\\u0026");
  });

  it("stays valid JSON that round-trips to the original value", () => {
    const value = { headline: "Grade 1 </script> & <b>bold</b>", n: 42, arr: ["x", "y"] };
    const out = serializeJsonLd(value);
    // The escaped \uXXXX sequences are valid JSON and decode back to the original.
    expect(JSON.parse(out)).toEqual(value);
  });

  it("leaves ordinary text unchanged in meaning", () => {
    expect(JSON.parse(serializeJsonLd({ a: "hello world" }))).toEqual({ a: "hello world" });
  });
});

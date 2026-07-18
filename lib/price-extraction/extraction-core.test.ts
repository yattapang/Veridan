import { describe, expect, it } from "vitest";
import {
  STALE_EXTRACTION_MINUTES,
  buildExtractionSystemPrompt,
  checkExtractionStartAllowed,
  classifyExtractionFile,
  isExtractionStale,
  parseExtraction,
  staleExtractionCutoffIso,
  stripJsonFences,
} from "./extraction-core";

describe("classifyExtractionFile", () => {
  it("classifies pdf/image/csv with the right media types", () => {
    expect(classifyExtractionFile("quote.pdf")).toEqual({
      kind: "pdf",
      mediaType: "application/pdf",
    });
    expect(classifyExtractionFile("photo.PNG").mediaType).toBe("image/png");
    expect(classifyExtractionFile("scan.jpeg").mediaType).toBe("image/jpeg");
    expect(classifyExtractionFile("scan.jpg").mediaType).toBe("image/jpeg");
    expect(classifyExtractionFile("shot.webp").mediaType).toBe("image/webp");
    expect(classifyExtractionFile("prices.csv").kind).toBe("csv");
  });

  it("recognizes spreadsheets (unsupported) and unknowns", () => {
    expect(classifyExtractionFile("prices.xlsx").kind).toBe("spreadsheet");
    expect(classifyExtractionFile("prices.xls").kind).toBe("spreadsheet");
    expect(classifyExtractionFile("notes.txt").kind).toBe("unknown");
  });
});

describe("stripJsonFences", () => {
  it("strips ```json fences", () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("strips bare fences", () => {
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves unfenced JSON alone", () => {
    expect(stripJsonFences('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe("parseExtraction", () => {
  it("parses a well-formed response", () => {
    const result = parseExtraction(
      JSON.stringify({
        supplier_detected: "Veridan Hardware",
        quote_metadata: {
          quote_ref: "Q-100",
          quote_date: "2026-07-01",
          currency: "USD",
          validity_text: "30 days",
        },
        line_items: [
          {
            raw_description: "Commercial Lever Lockset",
            product_ref_guess: "LK-450",
            qty: 10,
            unit_price: 42.5,
            currency: "USD",
            is_new_item_guess: false,
          },
        ],
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.supplier_detected).toBe("Veridan Hardware");
      expect(result.value.line_items).toHaveLength(1);
      expect(result.value.line_items[0].unit_price).toBe(42.5);
    }
  });

  it("strips fences before parsing", () => {
    const result = parseExtraction('```json\n{"line_items":[]}\n```');
    expect(result.ok).toBe(true);
  });

  it("coerces string/dirty numeric prices and missing fields to null", () => {
    const result = parseExtraction(
      JSON.stringify({
        line_items: [
          {
            raw_description: "  Hinge  ",
            product_ref_guess: "",
            qty: "5",
            unit_price: "$1,234.50",
            is_new_item_guess: "true",
          },
        ],
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const line = result.value.line_items[0];
      expect(line.raw_description).toBe("Hinge");
      expect(line.product_ref_guess).toBeNull();
      expect(line.qty).toBe(5);
      expect(line.unit_price).toBe(1234.5);
      expect(line.currency).toBeNull();
      expect(line.is_new_item_guess).toBe(true);
      // Missing quote_metadata entirely → all-null metadata object.
      expect(result.value.quote_metadata.quote_ref).toBeNull();
      expect(result.value.supplier_detected).toBeNull();
    }
  });

  it("filters out non-object line entries", () => {
    const result = parseExtraction(
      JSON.stringify({ line_items: [null, "junk", { raw_description: "ok" }] })
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.line_items).toHaveLength(1);
  });

  it("fails on non-JSON", () => {
    const result = parseExtraction("Sorry, I can't do that.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/i);
  });

  it("fails on JSON missing line_items array", () => {
    const result = parseExtraction(JSON.stringify({ supplier_detected: "X" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/line_items/i);
  });

  it("fails on an empty response", () => {
    const result = parseExtraction("   ");
    expect(result.ok).toBe(false);
  });
});

describe("buildExtractionSystemPrompt", () => {
  it("instructs the model to ignore instructions embedded in the document (MINOR-3)", () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toMatch(/ignore any instructions/i);
    expect(prompt).toMatch(/transcribe what is printed/i);
  });
});

describe("isExtractionStale / staleExtractionCutoffIso", () => {
  const now = Date.parse("2026-07-18T12:00:00.000Z");

  it("not stale within the window", () => {
    expect(isExtractionStale("2026-07-18T11:55:00.000Z", now)).toBe(false);
  });
  it("stale once older than the window", () => {
    expect(isExtractionStale("2026-07-18T11:49:59.000Z", now)).toBe(true);
  });
  it("exactly at the boundary is not yet stale", () => {
    const boundary = new Date(now - STALE_EXTRACTION_MINUTES * 60_000).toISOString();
    expect(isExtractionStale(boundary, now)).toBe(false);
  });
  it("an unreadable timestamp is treated as stale rather than wedging the upload", () => {
    expect(isExtractionStale("not-a-date", now)).toBe(true);
  });
  it("cutoff is exactly the staleness window before now", () => {
    expect(staleExtractionCutoffIso(now)).toBe(
      new Date(now - STALE_EXTRACTION_MINUTES * 60_000).toISOString()
    );
  });
});

describe("checkExtractionStartAllowed", () => {
  const now = Date.parse("2026-07-18T12:00:00.000Z");
  const fresh = "2026-07-18T11:58:00.000Z";
  const stale = "2026-07-18T11:00:00.000Z";

  it("allows pending and failed uploads", () => {
    expect(checkExtractionStartAllowed("pending", fresh, now)).toEqual({ ok: true, retryOfStale: false });
    expect(checkExtractionStartAllowed("failed", stale, now)).toEqual({ ok: true, retryOfStale: false });
  });

  it("refuses a fresh in-flight extraction", () => {
    const gate = checkExtractionStartAllowed("extracting", fresh, now);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.error).toMatch(/already running/i);
  });

  it("allows retrying a stalled extraction, flagged as a stale retry (MAJOR-4)", () => {
    expect(checkExtractionStartAllowed("extracting", stale, now)).toEqual({ ok: true, retryOfStale: true });
  });

  it("refuses review/completed uploads — a re-run would destroy review work (MAJOR-3)", () => {
    for (const status of ["review", "completed"] as const) {
      const gate = checkExtractionStartAllowed(status, stale, now);
      expect(gate.ok).toBe(false);
      if (!gate.ok) expect(gate.error).toMatch(/already been extracted/i);
    }
  });
});

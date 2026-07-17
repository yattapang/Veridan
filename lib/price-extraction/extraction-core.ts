/**
 * Phase 2B Task 37 — PURE helpers for the Claude extraction pipeline: the
 * prompt text, file classification, markdown-fence stripping, and a hand-rolled
 * defensive validator for the model's JSON (no zod, no new deps beyond the SDK).
 *
 * Kept free of the Anthropic/Supabase clients so the parsing + validation rules
 * are unit-testable without any I/O. The orchestration that actually calls
 * Claude and writes rows lives in extract.ts (server-only).
 *
 * GUARDRAIL (Plan §2.3): the schema below is cost-side only — raw_description,
 * product_ref_guess, qty, unit_price, currency. No client price, margin, or FX.
 */

/**
 * Extraction model. Plan brief: "claude-sonnet-5" — good extraction quality at
 * reasonable per-call cost (the founders pay per call).
 */
export const EXTRACTION_MODEL = "claude-sonnet-5";

export interface ExtractedLineItem {
  raw_description: string | null;
  product_ref_guess: string | null;
  qty: number | null;
  unit_price: number | null;
  currency: string | null;
  is_new_item_guess: boolean;
}

export interface ExtractionQuoteMetadata {
  quote_ref: string | null;
  quote_date: string | null;
  currency: string | null;
  validity_text: string | null;
}

export interface ExtractionResult {
  supplier_detected: string | null;
  quote_metadata: ExtractionQuoteMetadata;
  line_items: ExtractedLineItem[];
}

// ---------------------------------------------------------------------------
// File classification.
// ---------------------------------------------------------------------------

export type ExtractionFileKind = "pdf" | "image" | "csv" | "spreadsheet" | "unknown";

export interface ExtractionFileInfo {
  kind: ExtractionFileKind;
  /** Media type for the SDK content block (pdf/image only). */
  mediaType?: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
}

/**
 * Classify an uploaded file by extension for the extraction path.
 * Spreadsheets (.xlsx/.xls) are recognized but NOT supported for extraction in
 * this build (see extract.ts) — the caller fails them with a founder-readable
 * "export to CSV/PDF and re-upload" message.
 */
export function classifyExtractionFile(filename: string): ExtractionFileInfo {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return { kind: "pdf", mediaType: "application/pdf" };
  if (lower.endsWith(".png")) return { kind: "image", mediaType: "image/png" };
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return { kind: "image", mediaType: "image/jpeg" };
  if (lower.endsWith(".webp")) return { kind: "image", mediaType: "image/webp" };
  if (lower.endsWith(".csv")) return { kind: "csv" };
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return { kind: "spreadsheet" };
  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// Prompt.
// ---------------------------------------------------------------------------

export function buildExtractionSystemPrompt(): string {
  return [
    "You extract cost-side line items from a supplier's price quote for a hardware import business.",
    "You return ONLY structured data describing what the supplier's document says.",
    "You never compute client prices, markups, margins, taxes, or currency conversions — you only report the supplier's own numbers verbatim.",
    "If a value is absent or unreadable, use null rather than guessing.",
  ].join(" ");
}

/**
 * The user-turn instruction. `supplierHintName` is the uploader-confirmed
 * supplier (price_file_uploads.supplier_id), passed as a hint so the model can
 * confirm/deny rather than detect from scratch; null when undetected.
 */
export function buildExtractionUserText(supplierHintName: string | null): string {
  const hint = supplierHintName
    ? `The uploader indicated this quote is from supplier: "${supplierHintName}". Confirm or correct this in supplier_detected.`
    : "The supplier is not known in advance — detect it from the document if possible, else null.";

  return [
    "Extract this supplier quote into JSON with EXACTLY this shape and nothing else:",
    "",
    "{",
    '  "supplier_detected": string | null,',
    '  "quote_metadata": {',
    '    "quote_ref": string | null,',
    '    "quote_date": string | null,',
    '    "currency": string | null,',
    '    "validity_text": string | null',
    "  },",
    '  "line_items": [',
    "    {",
    '      "raw_description": string | null,',
    '      "product_ref_guess": string | null,',
    '      "qty": number | null,',
    '      "unit_price": number | null,',
    '      "currency": string | null,',
    '      "is_new_item_guess": boolean',
    "    }",
    "  ]",
    "}",
    "",
    hint,
    "",
    "Rules:",
    "- One object in line_items per priced line in the document.",
    "- raw_description is the supplier's own line text, as close to verbatim as possible.",
    "- product_ref_guess is the supplier/catalogue reference code if one is printed on the line, else null.",
    "- unit_price is the per-unit COST the supplier is charging (a plain number, no currency symbol, no thousands separators).",
    "- currency is the currency of that line's price (e.g. USD, CAD, GBP), else null to fall back to the quote-level currency.",
    "- is_new_item_guess: true if this looks like an item unlikely to already exist in a hardware library, your best guess.",
    "- Do NOT invent line items. If the document has no priced lines, return an empty line_items array.",
    "- Respond with the JSON object only. No prose, no markdown fences.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Parsing + validation.
// ---------------------------------------------------------------------------

/** Strip ```json … ``` (or bare ``` … ```) fences the model sometimes adds. */
export function stripJsonFences(text: string): string {
  let t = text.trim();
  const fence = /^```[a-zA-Z0-9]*\s*\n?([\s\S]*?)\n?```$/;
  const m = t.match(fence);
  if (m) t = m[1].trim();
  return t;
}

function toNullableString(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    // Tolerate "1,234.50", "$12.00", " 5 " — strip anything that isn't part of a number.
    const cleaned = value.replace(/[^0-9.\-]/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

export type ParseExtractionResult =
  | { ok: true; value: ExtractionResult }
  | { ok: false; error: string };

/**
 * Defensively parse + normalize the model's JSON into an ExtractionResult.
 * Strips fences, tolerates missing fields (coerced to null / empty), and only
 * hard-fails when the top-level shape is unusable (non-JSON, or line_items not
 * an array). No zod — plain checks, as the brief requires.
 */
export function parseExtraction(text: string): ParseExtractionResult {
  const stripped = stripJsonFences(text);
  if (!stripped) return { ok: false, error: "The extraction returned an empty response." };

  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    return { ok: false, error: "The extraction response was not valid JSON." };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "The extraction response was not a JSON object." };
  }

  const obj = raw as Record<string, unknown>;
  const rawLines = obj.line_items;
  if (!Array.isArray(rawLines)) {
    return { ok: false, error: "The extraction response was missing a line_items array." };
  }

  const metaRaw =
    typeof obj.quote_metadata === "object" && obj.quote_metadata !== null
      ? (obj.quote_metadata as Record<string, unknown>)
      : {};

  const line_items: ExtractedLineItem[] = rawLines
    .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
    .map((l) => ({
      raw_description: toNullableString(l.raw_description),
      product_ref_guess: toNullableString(l.product_ref_guess),
      qty: toNullableNumber(l.qty),
      unit_price: toNullableNumber(l.unit_price),
      currency: toNullableString(l.currency),
      is_new_item_guess: toBoolean(l.is_new_item_guess),
    }));

  return {
    ok: true,
    value: {
      supplier_detected: toNullableString(obj.supplier_detected),
      quote_metadata: {
        quote_ref: toNullableString(metaRaw.quote_ref),
        quote_date: toNullableString(metaRaw.quote_date),
        currency: toNullableString(metaRaw.currency),
        validity_text: toNullableString(metaRaw.validity_text),
      },
      line_items,
    },
  };
}

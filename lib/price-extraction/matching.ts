/**
 * Phase 2B Task 38 — PURE product-matching + confidence logic for the
 * supplier-quote scanner (Veridan_Phase2_Plan_v1.md §2.2 Stage 2–3).
 *
 * No Supabase client, no Anthropic client, no I/O — every function here is a
 * deterministic transform so it is unit-testable in isolation, mirroring the
 * lib/landed-cost/engine.ts and lib/item-groups.ts convention (Plan §6 Layer 1).
 *
 * GUARDRAIL (Plan §2.3): this module is cost-side only. It reads a supplier's
 * own quote line and maps it to a Hardware Library product (or an item group,
 * or nothing). It NEVER computes a client price, margin, or FX conversion, and
 * it never touches lib/landed-cost/ or lib/quotes/.
 */

import type { CurrencyCode } from "@/lib/supabase/types";
// Relative import for the runtime value — vitest here has no path-alias
// resolution for runtime imports (only type-only "@/..." imports are safe,
// since those are erased before module resolution). Same convention as
// lib/item-groups.ts.
import { CURRENCY_CODES } from "../supabase/types";

// ---------------------------------------------------------------------------
// Tunables (documented so the confidence formula isn't a black box).
// ---------------------------------------------------------------------------

/**
 * Below this combined score a supplier-scoped candidate is not considered a
 * real match — we fall through to the item-group cross-supplier fallback and
 * finally to "new item". Keeps a weak coincidental token overlap from being
 * presented as a match at all.
 */
export const MIN_MATCH_SCORE = 0.4;

/**
 * A ref carries far more identifying signal than free-text description tokens
 * (a catalogue/product ref is close to a key), so it dominates the blend when
 * a ref is present on both sides.
 */
export const REF_WEIGHT = 0.65;
export const DESC_WEIGHT = 0.35;

/**
 * Cross-supplier (item_group) matches are inherently less certain than a
 * same-supplier row match — it's the same *kind* of item from a different
 * supplier, not necessarily the identical offering. Cap their confidence so an
 * exact ref match across suppliers still reads as "strong but review-worthy"
 * rather than "certain".
 */
export const ITEM_GROUP_CONFIDENCE_CAP = 0.9;

export type MatchType = "exact_ref" | "fuzzy" | "item_group" | "none";
export type MatchReviewStatus = "confident" | "needs_review";

/** The product fields the matcher needs — a subset of ProductRow. */
export interface ProductCandidate {
  id: string;
  product_ref: string | null;
  catalogue_ref: string | null;
  description: string | null;
  supplier_id: string | null;
  item_group_id: string | null;
}

/** One extracted supplier-quote line, as far as matching cares. */
export interface ExtractedLineForMatch {
  raw_description: string | null;
  product_ref_guess: string | null;
  is_new_item_guess?: boolean;
}

export interface MatchResult {
  matchedProductId: string | null;
  itemGroupMatchId: string | null;
  confidenceScore: number;
  matchType: MatchType;
  reviewStatus: MatchReviewStatus;
}

// ---------------------------------------------------------------------------
// String normalization + similarity primitives.
// ---------------------------------------------------------------------------

/** Ref normalization: lowercase, strip everything but [a-z0-9]. So "US-32D " === "us32d". */
export function normalizeRef(value: string | null | undefined): string {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Text normalization: lowercase, collapse whitespace, trim. */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Description tokens: normalized, split on non-alphanumerics, drop 1-char noise. */
export function tokenize(value: string | null | undefined): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}

/** Standard Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Ref similarity in [0,1]. Empty on either side → 0 (no signal). Exact after
 * normalization → 1. Otherwise a normalized edit-distance similarity.
 */
export function refSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeRef(a);
  const nb = normalizeRef(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.max(0, 1 - dist / maxLen);
}

/** Description similarity in [0,1] via Jaccard token overlap. */
export function descriptionSimilarity(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Combined line↔candidate score in [0,1], and whether it was an exact ref hit.
 *
 * Formula (documented for the independent reviewer):
 *   - exactRef when the line ref, normalized, equals the candidate's
 *     product_ref OR catalogue_ref, normalized (both non-empty).
 *   - refSim   = best of (line ref vs product_ref, line ref vs catalogue_ref).
 *   - descSim  = Jaccard token overlap of the raw description vs the product
 *                description.
 *   - if a ref is present on the line AND on the candidate:
 *        score = REF_WEIGHT*refSim + DESC_WEIGHT*descSim
 *     else (no usable ref signal): score = descSim alone, so a ref-less line
 *     isn't penalized for a signal it could never have provided.
 */
export function scoreCandidate(
  line: ExtractedLineForMatch,
  candidate: ProductCandidate
): { score: number; exactRef: boolean } {
  const lineRef = normalizeRef(line.product_ref_guess);
  const productRef = normalizeRef(candidate.product_ref);
  const catalogueRef = normalizeRef(candidate.catalogue_ref);

  const candidateHasRef = Boolean(productRef || catalogueRef);
  const exactRef = Boolean(lineRef) && (lineRef === productRef || lineRef === catalogueRef);

  const refSim = Math.max(
    refSimilarity(line.product_ref_guess, candidate.product_ref),
    refSimilarity(line.product_ref_guess, candidate.catalogue_ref)
  );
  const descSim = descriptionSimilarity(line.raw_description, candidate.description);

  const refUsable = Boolean(lineRef) && candidateHasRef;
  const score = refUsable ? REF_WEIGHT * refSim + DESC_WEIGHT * descSim : descSim;

  return { score: exactRef ? 1 : score, exactRef };
}

interface BestCandidate {
  candidate: ProductCandidate;
  score: number;
  exactRef: boolean;
}

function bestCandidate(
  line: ExtractedLineForMatch,
  candidates: ProductCandidate[]
): BestCandidate | null {
  let best: BestCandidate | null = null;
  for (const candidate of candidates) {
    const { score, exactRef } = scoreCandidate(line, candidate);
    if (!best || score > best.score) best = { candidate, score, exactRef };
  }
  return best;
}

/**
 * Match one extracted line against Hardware Library product candidates.
 *
 * Strategy (Plan §2.2 Stage 2):
 *   1. Exact product_ref/catalogue_ref match scoped to the file's supplier →
 *      highest confidence (1.0), matchType "exact_ref".
 *   2. Fuzzy ref + description overlap within the supplier's own rows, when the
 *      combined score ≥ MIN_MATCH_SCORE → matchType "fuzzy", confidence = score.
 *   3. Item-group cross-supplier fallback (same item, different supplier's
 *      quote): among candidates that HAVE an item_group_id and belong to a
 *      DIFFERENT supplier, take the best; if it clears the bar, record
 *      itemGroupMatchId (NOT matchedProductId), confidence capped at
 *      ITEM_GROUP_CONFIDENCE_CAP → matchType "item_group".
 *   4. Otherwise no match → matchType "none" (this is the is_new_item path).
 *
 * `fileSupplierId` null means the supplier is still undetected — every product
 * is then in scope for steps 1–2 and the cross-supplier step (3) is skipped
 * (there's no "other supplier" to fall back to).
 *
 * reviewStatus = confidenceScore ≥ threshold ? "confident" : "needs_review".
 */
export function matchExtractedLine(
  line: ExtractedLineForMatch,
  candidates: ProductCandidate[],
  fileSupplierId: string | null,
  threshold: number
): MatchResult {
  const withStatus = (partial: Omit<MatchResult, "reviewStatus">): MatchResult => ({
    ...partial,
    reviewStatus: partial.confidenceScore >= threshold ? "confident" : "needs_review",
  });

  const none: MatchResult = withStatus({
    matchedProductId: null,
    itemGroupMatchId: null,
    confidenceScore: 0,
    matchType: "none",
  });

  if (candidates.length === 0) return none;

  const supplierScoped = fileSupplierId
    ? candidates.filter((c) => c.supplier_id === fileSupplierId)
    : candidates;

  // Steps 1 & 2 — best within supplier scope.
  const best = bestCandidate(line, supplierScoped);
  if (best && best.exactRef) {
    return withStatus({
      matchedProductId: best.candidate.id,
      itemGroupMatchId: null,
      confidenceScore: 1,
      matchType: "exact_ref",
    });
  }
  if (best && best.score >= MIN_MATCH_SCORE) {
    return withStatus({
      matchedProductId: best.candidate.id,
      itemGroupMatchId: null,
      confidenceScore: best.score,
      matchType: "fuzzy",
    });
  }

  // Step 3 — item-group cross-supplier fallback (only when a supplier is known).
  if (fileSupplierId) {
    const crossSupplier = candidates.filter(
      (c) => c.item_group_id && c.supplier_id !== fileSupplierId
    );
    const bestCross = bestCandidate(line, crossSupplier);
    if (bestCross && (bestCross.exactRef || bestCross.score >= MIN_MATCH_SCORE)) {
      const rawConfidence = bestCross.exactRef ? 1 : bestCross.score;
      return withStatus({
        matchedProductId: null,
        itemGroupMatchId: bestCross.candidate.item_group_id,
        confidenceScore: Math.min(rawConfidence, ITEM_GROUP_CONFIDENCE_CAP),
        matchType: "item_group",
      });
    }
  }

  // Step 4 — nothing matched.
  return none;
}

// ---------------------------------------------------------------------------
// Currency normalization (cost-side only — never used for FX).
// ---------------------------------------------------------------------------

const CURRENCY_SYNONYMS: Record<string, CurrencyCode> = {
  $: "USD",
  usd: "USD",
  us$: "USD",
  usdollar: "USD",
  usdollars: "USD",
  dollar: "USD",
  dollars: "USD",
  "c$": "CAD",
  cad: "CAD",
  cadollar: "CAD",
  canadian: "CAD",
  "j$": "JMD",
  jmd: "JMD",
  jamaican: "JMD",
  "£": "GBP",
  gbp: "GBP",
  pound: "GBP",
  pounds: "GBP",
  sterling: "GBP",
  "€": "EUR",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
};

/**
 * Maps a raw currency string from an extraction to a supported CurrencyCode,
 * or null when it can't be resolved. Purely a labeling normalization on
 * cost-side data — it performs NO conversion between currencies.
 */
export function normalizeCurrency(raw: string | null | undefined): CurrencyCode | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  if ((CURRENCY_CODES as string[]).includes(trimmed)) return trimmed as CurrencyCode;

  const key = raw.trim().toLowerCase().replace(/\s+/g, "");
  return CURRENCY_SYNONYMS[key] ?? null;
}

// ---------------------------------------------------------------------------
// Supplier detection (fuzzy-match the extracted supplier name to a row).
// ---------------------------------------------------------------------------

export interface SupplierForMatch {
  id: string;
  name: string;
}

export interface SupplierMatchResult {
  supplierId: string | null;
  confidence: number;
}

/**
 * Fuzzy-match an extracted supplier name against the suppliers table.
 * Confidence blends ref-style similarity of the whole normalized name with
 * token overlap, so "Veridan Hardware Ltd." matches "Veridan Hardware" highly
 * even with the suffix difference. Returns the best supplier and its score;
 * callers decide the auto-assign threshold (Plan: only auto-set above 0.8).
 */
export function fuzzySupplierMatch(
  detectedName: string | null | undefined,
  suppliers: SupplierForMatch[]
): SupplierMatchResult {
  if (!detectedName || suppliers.length === 0) {
    return { supplierId: null, confidence: 0 };
  }

  let best: SupplierMatchResult = { supplierId: null, confidence: 0 };
  for (const supplier of suppliers) {
    const nameSim = refSimilarity(detectedName, supplier.name);
    const tokenSim = descriptionSimilarity(detectedName, supplier.name);
    const confidence = Math.max(nameSim, 0.5 * nameSim + 0.5 * tokenSim);
    if (confidence > best.confidence) {
      best = { supplierId: supplier.id, confidence };
    }
  }
  return best;
}

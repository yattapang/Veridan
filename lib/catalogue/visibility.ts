/**
 * The §3.3 visibility guardrail, as pure logic — testable independent of
 * RLS/Storage, per Plan §6 Layer 1 ("the catalogue visibility gate as a pure
 * function ... so the 'live re-check' guarantee in §3.3 has a unit test, not
 * just an integration one").
 *
 * IMPORTANT: `isDownloadable` itself is trivial (visibility === 'public').
 * The actual safety property — that a flipped-back-to-internal document
 * stops being servable IMMEDIATELY, not on some cache's schedule — comes
 * from WHEN this function is called: lib/catalogue/gatedDownload.ts calls it
 * against a row re-read from the database on every single request, never a
 * cached or earlier-selected row. This file only supplies the predicate;
 * the freshness guarantee lives in the caller.
 */

import type { CatalogueVisibility } from "../supabase/types";

/** Every insert lands here unless a founder explicitly overrides it — mirrors the schema-level default in the migration. Kept as a named constant so callers never hand-type the string. */
export const DEFAULT_CATALOGUE_VISIBILITY: CatalogueVisibility = "internal";

export function isValidCatalogueVisibility(value: unknown): value is CatalogueVisibility {
  return value === "internal" || value === "public";
}

/**
 * Parses an untrusted form value (e.g. a <select> value from FormData) into
 * a CatalogueVisibility, falling back to the safe default for anything
 * missing, blank, or unrecognized — a malformed/absent form field can never
 * result in 'public'.
 */
export function parseCatalogueVisibility(value: unknown): CatalogueVisibility {
  return isValidCatalogueVisibility(value) ? value : DEFAULT_CATALOGUE_VISIBILITY;
}

/**
 * THE gate a document's file must pass before its bytes are ever served
 * publicly. Call this ONLY against a value just read from the database
 * (never a value cached from an earlier point in the same request, and
 * never a client-supplied claim) — see lib/catalogue/gatedDownload.ts, the
 * sole caller in the download/thumbnail routes.
 */
export function isDownloadable(document: { visibility: CatalogueVisibility }): boolean {
  return document.visibility === "public";
}

/** Toggle target for the admin "flip visibility" control — pure so the button's next-state label is testable without a click. */
export function nextCatalogueVisibility(current: CatalogueVisibility): CatalogueVisibility {
  return current === "public" ? "internal" : "public";
}

/** True only for the transition that needs the rights-confirmation gate (Plan §3.3) — going internal -> public. The reverse (public -> internal, i.e. making something private again) never needs a warning. */
export function transitionNeedsRightsConfirmation(
  current: CatalogueVisibility,
  next: CatalogueVisibility
): boolean {
  return current !== "public" && next === "public";
}

/**
 * The exact warning text the plan requires "next to the publish/visibility
 * control in the admin UI" (brief, §3.3). Kept as one exported constant so
 * the upload form, the edit view, and the toggle's confirm dialog all show
 * byte-identical wording.
 */
export const CATALOGUE_RIGHTS_CONFIRMATION_WARNING =
  "Confirm you are licensed to publish this supplier's catalogue publicly before making it visible.";

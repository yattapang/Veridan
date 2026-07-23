/**
 * Safe serialization for JSON-LD injected via `dangerouslySetInnerHTML` into a
 * `<script type="application/ld+json">` element.
 *
 * `JSON.stringify` escapes `"` and control characters but NOT `<`, `>`, or `&`
 * — so a founder-editable field containing a closing `</script>` sequence (an
 * article title, the site tagline — both DB-editable now) would close the
 * script element early and let the remainder parse as live markup: a stored
 * XSS on the public site (Phase 3B review B1). Escaping each such character to
 * its unicode-escape form keeps the JSON structurally identical (a JSON parser
 * decodes it back to the same character) while making script-tag breakout
 * impossible. Standard mitigation for embedding JSON in HTML.
 */
const BACKSLASH = String.fromCharCode(92);

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(
    /[<>&]/g,
    (ch) => BACKSLASH + "u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

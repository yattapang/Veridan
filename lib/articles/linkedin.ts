/**
 * Phase 3B — "Copy LinkedIn-ready text" (Plan §2.4, §8 open question 10
 * RESOLVED: deterministic, excerpt-based template — NOT a second Claude API
 * call, to avoid the extra API cost/surface for a purely mechanical
 * transform). Pure and synchronous: the caller (the editor's client
 * component) copies the result to the clipboard directly; nothing here ever
 * makes a network call, to LinkedIn or anywhere else — see the Plan §2.6
 * non-goal ("no LinkedIn API integration of any kind").
 */

export interface LinkedinCaptionInput {
  title: string;
  excerpt: string | null;
  /** Full public URL of the published article, e.g. https://www.veridanlimited.com/articles/<slug>. */
  url: string;
}

/**
 * Builds a ready-to-paste LinkedIn caption: title, then the excerpt (if
 * any), then a "Read more" line with the article's public URL. Deliberately
 * plain — no hashtags or emoji invented on the founder's behalf.
 */
export function buildLinkedinCaption(input: LinkedinCaptionInput): string {
  const parts = [input.title.trim()];
  const excerpt = input.excerpt?.trim();
  if (excerpt) parts.push(excerpt);
  parts.push(`Read more: ${input.url}`);
  return parts.join("\n\n");
}

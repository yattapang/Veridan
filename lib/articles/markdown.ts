/**
 * Phase 3B — a small, dependency-free markdown-to-safe-HTML renderer (Plan
 * §2.4: "body as a plain markdown textarea + rendered preview pane (not a
 * WYSIWYG editor — keeps the dependency surface small)"). Used for both the
 * admin editor's live preview and the public article page's body render, so
 * it must be genuinely safe: every character of the SOURCE text is
 * HTML-escaped up front, and markdown constructs are then layered back in as
 * a fixed, known-safe set of tags — raw HTML typed or pasted into the
 * textarea (or returned by the AI drafter) can never reach the page as live
 * markup, only as escaped, inert text.
 *
 * Deliberately minimal: headings (# .. ######), paragraphs, bold/italic,
 * inline code, fenced code blocks, links (http(s)/mailto/relative only —
 * `javascript:` and other schemes are stripped), blockquotes, and
 * ordered/unordered lists. No tables, no images, no raw HTML passthrough —
 * anything beyond this set renders as plain escaped text, which is a safe
 * degradation, not a bug.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Allow http(s)/mailto and relative paths only; anything else (incl. `javascript:`) is rejected. */
function sanitizeHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (href.startsWith("/") || href.startsWith("#")) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^mailto:/i.test(href)) return href;
  return null;
}

/**
 * Inline-level formatting within a single line/paragraph, applied to
 * ALREADY-escaped text. Code spans are pulled out into placeholders before
 * any other inline rule runs, and restored last, so a bold/italic/link
 * pattern typed literally inside `backticks` is never processed as markdown
 * (e.g. `` `**not-bold**` `` must render the asterisks literally).
 */
function renderInline(escapedText: string): string {
  const codeSpans: string[] = [];
  let out = escapedText.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `@@CODESPAN${codeSpans.length - 1}@@`;
  });

  // Links [label](href) — href is sanitized; an unsafe scheme degrades to plain label text.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const safeHref = sanitizeHref(href);
    return safeHref
      ? `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
  });

  // Bold (**text** or __text__), then italic (*text* or _text_).
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, "$1<em>$2</em>");

  out = out.replace(/@@CODESPAN(\d+)@@/g, (_m, i: string) => codeSpans[Number(i)]);

  return out;
}

interface ListState {
  type: "ul" | "ol";
  items: string[];
}

/**
 * Render a markdown string into a small, fixed set of safe HTML tags.
 * Block-level, line-oriented parser — good enough for founder-authored and
 * AI-drafted articles, not a spec-complete CommonMark implementation.
 */
export function renderMarkdownToSafeHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const htmlParts: string[] = [];

  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: ListState | null = null;
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const text = renderInline(escapeHtml(paragraph.join(" ")));
    htmlParts.push(`<p>${text}</p>`);
    paragraph = [];
  }

  function flushQuote() {
    if (quote.length === 0) return;
    const text = renderInline(escapeHtml(quote.join(" ")));
    htmlParts.push(`<blockquote><p>${text}</p></blockquote>`);
    quote = [];
  }

  function flushList() {
    if (!list) return;
    const items = list.items.map((item) => `<li>${renderInline(escapeHtml(item))}</li>`).join("");
    htmlParts.push(`<${list.type}>${items}</${list.type}>`);
    list = null;
  }

  function flushAll() {
    flushParagraph();
    flushQuote();
    flushList();
  }

  for (const rawLine of lines) {
    const line = rawLine;

    // Fenced code blocks (```lang … ```) — content is escaped but never
    // markdown-processed, and never dropped even if the closing fence is
    // missing (better to render everything than silently truncate).
    const fenceMatch = line.match(/^```/);
    if (fenceMatch) {
      if (inCodeBlock) {
        htmlParts.push(`<pre><code>${escapeHtml(codeBlockLines.join("\n"))}</code></pre>`);
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        flushAll();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushAll();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushAll();
      const level = headingMatch[1].length;
      htmlParts.push(`<h${level}>${renderInline(escapeHtml(headingMatch[2].trim()))}</h${level}>`);
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1]);
      continue;
    }

    const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
    const olMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ulMatch || olMatch) {
      flushParagraph();
      flushQuote();
      const type = ulMatch ? "ul" : "ol";
      const itemText = (ulMatch ?? olMatch)![1];
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(itemText);
      continue;
    }

    // Plain paragraph text — accumulate; flushed on the next blank line or
    // block-level element.
    flushQuote();
    flushList();
    paragraph.push(trimmed);
  }

  // EOF: close out any dangling code block (missing closing fence) and
  // whatever paragraph/quote/list was still accumulating.
  if (inCodeBlock) {
    htmlParts.push(`<pre><code>${escapeHtml(codeBlockLines.join("\n"))}</code></pre>`);
  }
  flushAll();

  return htmlParts.join("\n");
}

/** Strips markdown syntax down to plain inline text — used for excerpts/previews where no HTML is wanted. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

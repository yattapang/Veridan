import { describe, expect, it } from "vitest";
import { markdownToPlainText, renderMarkdownToSafeHtml } from "./markdown";

describe("renderMarkdownToSafeHtml — safety", () => {
  it("escapes raw HTML rather than rendering it live", () => {
    const html = renderMarkdownToSafeHtml('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an inline HTML tag embedded in a paragraph", () => {
    const html = renderMarkdownToSafeHtml("Click <img src=x onerror=alert(1)> here");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("strips a javascript: link href, keeping the label as plain text", () => {
    const html = renderMarkdownToSafeHtml("[click me](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain("click me");
  });

  it("allows an https link through with rel=noopener", () => {
    const html = renderMarkdownToSafeHtml("[Veridan](https://www.veridanlimited.com)");
    expect(html).toContain('href="https://www.veridanlimited.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("allows a relative link", () => {
    const html = renderMarkdownToSafeHtml("[Contact us](/contact)");
    expect(html).toContain('href="/contact"');
  });
});

describe("renderMarkdownToSafeHtml — block structure", () => {
  it("renders headings at every level", () => {
    expect(renderMarkdownToSafeHtml("# H1")).toBe("<h1>H1</h1>");
    expect(renderMarkdownToSafeHtml("### H3")).toBe("<h3>H3</h3>");
  });

  it("renders separate paragraphs split by a blank line", () => {
    const html = renderMarkdownToSafeHtml("First paragraph.\n\nSecond paragraph.");
    expect(html).toBe("<p>First paragraph.</p>\n<p>Second paragraph.</p>");
  });

  it("joins wrapped lines within one paragraph", () => {
    const html = renderMarkdownToSafeHtml("Line one\nLine two still same paragraph.");
    expect(html).toBe("<p>Line one Line two still same paragraph.</p>");
  });

  it("renders an unordered list", () => {
    const html = renderMarkdownToSafeHtml("- First\n- Second\n- Third");
    expect(html).toBe("<ul><li>First</li><li>Second</li><li>Third</li></ul>");
  });

  it("renders an ordered list", () => {
    const html = renderMarkdownToSafeHtml("1. First\n2. Second");
    expect(html).toBe("<ol><li>First</li><li>Second</li></ol>");
  });

  it("renders a blockquote", () => {
    const html = renderMarkdownToSafeHtml("> A quoted line");
    expect(html).toBe("<blockquote><p>A quoted line</p></blockquote>");
  });

  it("renders a fenced code block verbatim, without inline processing", () => {
    const html = renderMarkdownToSafeHtml("```\n**not bold**\n```");
    expect(html).toBe("<pre><code>**not bold**</code></pre>");
  });

  it("closes a dangling code block missing its closing fence", () => {
    const html = renderMarkdownToSafeHtml("```\nunterminated");
    expect(html).toBe("<pre><code>unterminated</code></pre>");
  });
});

describe("renderMarkdownToSafeHtml — inline formatting", () => {
  it("renders bold and italic", () => {
    expect(renderMarkdownToSafeHtml("**bold** and *italic*")).toBe(
      "<p><strong>bold</strong> and <em>italic</em></p>"
    );
  });

  it("renders inline code without further inline processing inside it", () => {
    const html = renderMarkdownToSafeHtml("Use `**not-bold**` here");
    expect(html).toBe("<p>Use <code>**not-bold**</code> here</p>");
  });
});

describe("markdownToPlainText", () => {
  it("strips markdown syntax down to plain text", () => {
    expect(markdownToPlainText("# Heading\n\nSome **bold** and [a link](/x) text.")).toBe(
      "Heading Some bold and a link text."
    );
  });

  it("drops fenced code blocks", () => {
    expect(markdownToPlainText("Before\n\n```\ncode here\n```\n\nAfter")).toBe("Before After");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownToPlainText, renderMarkdownToSafeHtml } from "./markdown";

const TRUSTED_SUPABASE_URL = "https://yjwlfzmyzxrxgjhkhwms.supabase.co";

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

describe("renderMarkdownToSafeHtml — images", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders a relative-path image with a caption as a figure", () => {
    const html = renderMarkdownToSafeHtml('![A door install](/images/door.jpg "Installed last week")');
    expect(html).toBe(
      '<p><figure><img src="/images/door.jpg" alt="A door install" loading="lazy" /><figcaption>Installed last week</figcaption></figure></p>'
    );
  });

  it("omits the figcaption entirely when no title is given", () => {
    const html = renderMarkdownToSafeHtml("![A door install](/images/door.jpg)");
    expect(html).toContain('<figure><img src="/images/door.jpg" alt="A door install" loading="lazy" /></figure>');
    expect(html).not.toContain("<figcaption>");
  });

  it("renders an https image on the project's own Supabase Storage host", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", TRUSTED_SUPABASE_URL);
    const html = renderMarkdownToSafeHtml(
      `![A door install](${TRUSTED_SUPABASE_URL}/storage/v1/object/public/article-hero-images/1/door.jpg)`
    );
    expect(html).toContain(
      `<img src="${TRUSTED_SUPABASE_URL}/storage/v1/object/public/article-hero-images/1/door.jpg"`
    );
  });

  it("matches the image rule before the link rule, so no stray '!' or broken <a> appears", () => {
    const html = renderMarkdownToSafeHtml("![alt text](/images/door.jpg)");
    expect(html).not.toContain("!<a");
    expect(html).not.toContain("!<figure");
  });

  describe("attack shapes — every one degrades to plain alt text, never an unsafe or broken tag", () => {
    it("rejects a javascript: src", () => {
      const html = renderMarkdownToSafeHtml('![click me](javascript:alert(1) "cap")');
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<figure");
      expect(html).toContain("click me");
    });

    it("rejects a data: src", () => {
      const html = renderMarkdownToSafeHtml("![alt](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)");
      expect(html).not.toContain("data:");
      expect(html).not.toContain("<img");
      expect(html).toContain("alt");
    });

    it("rejects an off-host absolute https URL", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", TRUSTED_SUPABASE_URL);
      const html = renderMarkdownToSafeHtml("![alt](https://evil.example.com/x.png)");
      expect(html).not.toContain("evil.example.com");
      expect(html).not.toContain("<img");
      expect(html).toContain("alt");
    });

    it("rejects a plain http (non-https) URL even on the trusted host", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", TRUSTED_SUPABASE_URL);
      const html = renderMarkdownToSafeHtml("![alt](http://yjwlfzmyzxrxgjhkhwms.supabase.co/x.png)");
      expect(html).not.toContain("<img");
      expect(html).toContain("alt");
    });

    it("rejects a protocol-relative //host src that would resolve to an arbitrary host", () => {
      const html = renderMarkdownToSafeHtml("![alt](//evil.example.com/x.png)");
      expect(html).not.toContain("evil.example.com");
      expect(html).not.toContain("<img");
      expect(html).toContain("alt");
    });

    it("an src attempting to break out of the attribute with a quote never produces a broken/unsafe tag", () => {
      // Source text is HTML-escaped up front, so a literal `"` in the
      // markdown source arrives here as `&quot;` — it can never appear as a
      // raw attribute-breaking quote. The whitespace inside `onerror="` also
      // breaks the image pattern's src token (no whitespace allowed), so
      // this never matches the image rule at all and degrades to inert,
      // fully-escaped plain text — no <img>/<figure> is produced, and no
      // live (unescaped) `"` character appears anywhere in the output.
      const html = renderMarkdownToSafeHtml('![alt](/foo.jpg" onerror="alert(1))');
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<figure");
      expect(html).not.toMatch(/"/);
      expect(html).toContain("&quot;");
    });

    it("an src attempting to break out with a raw '>' never produces a broken/unsafe tag", () => {
      const html = renderMarkdownToSafeHtml('![alt](/foo.jpg><script>alert(1)</script>)');
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("alt text containing HTML stays escaped exactly like other source text", () => {
      const html = renderMarkdownToSafeHtml('![<img src=x onerror=alert(1)>](/images/door.jpg)');
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    it("caption text containing HTML stays escaped exactly like other source text", () => {
      const html = renderMarkdownToSafeHtml('![alt](/images/door.jpg "<script>alert(1)</script>")');
      expect(html).not.toContain("<script>alert");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });
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

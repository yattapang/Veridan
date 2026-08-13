"use client";

import { useState, useTransition } from "react";
import { uploadArticleBodyImage } from "../../actions";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";
const buttonClass =
  "rounded-md border border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-50";

/** Builds the exact `![alt](url "Caption")` snippet — omits the title entirely when no caption was entered, matching lib/articles/markdown.ts's rule for when a figcaption renders. */
function buildSnippet(url: string, alt: string, caption: string): string {
  const safeAlt = alt.trim();
  const safeCaption = caption.trim();
  return safeCaption ? `![${safeAlt}](${url} "${safeCaption}")` : `![${safeAlt}](${url})`;
}

/**
 * Upload a photo to place INSIDE the article body (as opposed to
 * HeroImageUploader, which sets the one hero image field on the article
 * row). This never touches the article — it uploads to the same public
 * `article-hero-images` bucket the hero image uses, then hands the founder
 * a ready-made markdown snippet to paste into the body wherever they want
 * the photo, complete with alt text and an optional caption so there's
 * nothing left to hand-edit.
 */
export function BodyImageUploader({ articleId }: { articleId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [snippet, setSnippet] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleUpload() {
    if (!file) {
      setError("Choose an image file.");
      return;
    }
    setError(null);
    setCopied(false);
    const formData = new FormData();
    formData.set("body_image", file);
    startTransition(async () => {
      const result = await uploadArticleBodyImage(articleId, formData);
      if (!result.ok) {
        setError(result.error);
        setSnippet(null);
        return;
      }
      setSnippet(buildSnippet(result.url, alt, caption));
    });
  }

  async function handleCopy() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setError("Could not copy to clipboard — copy the snippet manually below.");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-veridan-warm-gray">
        Upload a photo to place inside the body — separate from the hero image above. Fill in alt text
        and an optional caption, upload, then copy the snippet and paste it into the body where the
        photo belongs.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="body_image_alt">
            Alt text
          </label>
          <input
            id="body_image_alt"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="Describes the photo, for screen readers"
            className={`${inputClass} mt-1`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="body_image_caption">
            Caption (optional)
          </label>
          <input
            id="body_image_caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Shown under the photo on the page"
            className={`${inputClass} mt-1`}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className={`${inputClass} max-w-xs file:mr-3 file:rounded-md file:border-0 file:bg-veridan-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:uppercase file:tracking-wide file:text-veridan-paper`}
        />
        <button type="button" onClick={handleUpload} disabled={pending || !file} className={primaryButtonClass}>
          {pending ? "Uploading…" : "Upload photo"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {snippet && (
        <div className="rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale p-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-veridan-warm-gray">
            Paste this into the body where the photo belongs
          </p>
          <code className="block break-all text-xs text-veridan-ink">{snippet}</code>
          <button type="button" onClick={handleCopy} className={`${buttonClass} mt-2`}>
            {copied ? "Copied!" : "Copy snippet"}
          </button>
        </div>
      )}
    </div>
  );
}

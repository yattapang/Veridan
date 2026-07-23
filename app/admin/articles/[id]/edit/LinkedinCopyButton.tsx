"use client";

import { useState, useTransition } from "react";
import { buildLinkedinCaption } from "@/lib/articles/linkedin";
import { markLinkedinCrossPosted } from "../../actions";

const buttonClass =
  "rounded-md border border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-50";

/**
 * "Copy LinkedIn-ready text" (Plan §2.4, §8 Q10 resolved: deterministic,
 * NOT a second AI call). Copies a template built purely from title/excerpt/
 * URL to the clipboard, then records `linkedin_cross_posted`. Makes zero
 * network calls to any LinkedIn endpoint anywhere in this component (Plan
 * §2.6 non-goal) — the only network call here is the Server Action that
 * flips a boolean on our own `articles` row.
 */
export function LinkedinCopyButton({
  articleId,
  title,
  excerpt,
  publicUrl,
  alreadyCrossPosted,
}: {
  articleId: string;
  title: string;
  excerpt: string | null;
  publicUrl: string;
  alreadyCrossPosted: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [crossPosted, setCrossPosted] = useState(alreadyCrossPosted);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    const caption = buildLinkedinCaption({ title, excerpt, url: publicUrl });

    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(caption);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      } catch {
        setError("Could not copy to clipboard — copy the text manually from the article.");
        return;
      }

      const result = await markLinkedinCrossPosted(articleId);
      if (result.ok) setCrossPosted(true);
    });
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={pending} className={buttonClass}>
        {copied ? "Copied!" : "Copy LinkedIn-ready text"}
      </button>
      {crossPosted && <p className="mt-1 text-xs text-veridan-warm-gray">Marked as cross-posted to LinkedIn.</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

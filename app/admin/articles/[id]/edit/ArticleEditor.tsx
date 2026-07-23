"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { SUGGESTED_ARTICLE_CATEGORIES } from "@/lib/articles/categories";
import { renderMarkdownToSafeHtml } from "@/lib/articles/markdown";
import type { ArticleRow, ArticleStatus } from "@/lib/supabase/types";
import {
  moveArticleToReview,
  publishArticle,
  revertArticleToDraft,
  saveArticleFields,
  type ArticleActionResult,
} from "../../actions";
import { AiAssistPanel } from "./AiAssistPanel";
import { HeroImageUploader } from "./HeroImageUploader";
import { LinkedinCopyButton } from "./LinkedinCopyButton";

const initialSaveResult: ArticleActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";
const buttonClass =
  "rounded-md border border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-50";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

const STATUS_BADGE_CLASS: Record<ArticleStatus, string> = {
  draft: "bg-veridan-warm-gray-pale text-veridan-warm-gray",
  review: "bg-amber-50 text-amber-800",
  published: "bg-emerald-50 text-emerald-800",
};

/** Explicit Draft → Review → Published status buttons (Plan §2.4 — never implicit). */
function StatusActions({ articleId, status }: { articleId: string; status: ArticleStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<ArticleActionResult>, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <button
            type="button"
            className={primaryButtonClass}
            disabled={pending}
            onClick={() => run(() => moveArticleToReview(articleId))}
          >
            Move to review
          </button>
        )}
        {status === "review" && (
          <>
            <button
              type="button"
              className={buttonClass}
              disabled={pending}
              onClick={() => run(() => revertArticleToDraft(articleId))}
            >
              Back to draft
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={pending}
              onClick={() =>
                run(
                  () => publishArticle(articleId),
                  "Publish this article to the live site now?"
                )
              }
            >
              Publish
            </button>
          </>
        )}
        {status === "published" && (
          <button
            type="button"
            className={buttonClass}
            disabled={pending}
            onClick={() =>
              run(
                () => revertArticleToDraft(articleId),
                "Unpublish this article? It will disappear from the public site immediately."
              )
            }
          >
            Unpublish (back to draft)
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function ArticleEditor({
  article,
  heroImageUrl,
  publicUrl,
}: {
  article: ArticleRow;
  heroImageUrl: string | null;
  publicUrl: string;
}) {
  const [state, formAction, pending] = useActionState(
    saveArticleFields.bind(null, article.id),
    initialSaveResult
  );

  const [body, setBody] = useState(article.body ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const [everAiAssisted, setEverAiAssisted] = useState(article.ai_assisted);

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/articles" className="text-xs text-veridan-warm-gray hover:text-veridan-ink">
            ← All articles
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-veridan-ink">Edit article</h1>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE_CLASS[article.status]}`}
            >
              {article.status}
            </span>
          </div>
        </div>
        <StatusActions articleId={article.id} status={article.status} />
      </div>

      {article.status === "published" && (
        <p className="mb-6 text-xs text-veridan-warm-gray">
          Live at{" "}
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="text-veridan-accent-text hover:underline">
            {publicUrl}
          </a>
        </p>
      )}

      <form action={formAction} className="space-y-6">
        <input type="hidden" name="ai_assisted_this_save" value={everAiAssisted ? "true" : "false"} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="title">
              Title
            </label>
            <input id="title" name="title" required defaultValue={article.title} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className={labelClass} htmlFor="slug">
              Slug
            </label>
            <input id="slug" name="slug" defaultValue={article.slug} className={`${inputClass} mt-1`} />
            <p className="mt-1 text-[11px] text-veridan-warm-gray">
              Leave as-is to keep the current URL, or edit it — a collision auto-appends a number.
            </p>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="excerpt">
            Excerpt
          </label>
          <textarea
            id="excerpt"
            name="excerpt"
            rows={2}
            defaultValue={article.excerpt ?? ""}
            placeholder="One or two sentences shown in the article list and used as the SEO description fallback."
            className={`${inputClass} mt-1`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="category">
            Category
          </label>
          <input
            id="category"
            name="category"
            list="category-suggestions"
            defaultValue={article.category ?? ""}
            placeholder="Pick a suggestion or type your own"
            className={`${inputClass} mt-1`}
          />
          <datalist id="category-suggestions">
            {SUGGESTED_ARTICLE_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className={labelClass} htmlFor="body">
              Body (Markdown)
            </label>
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-xs font-medium text-veridan-accent-text hover:underline"
            >
              {showPreview ? "Edit" : "Preview"}
            </button>
          </div>
          {showPreview ? (
            <div
              className="prose prose-sm min-h-[280px] max-w-none rounded-md border border-veridan-warm-gray-light bg-white px-4 py-3"
              // Safe: renderMarkdownToSafeHtml escapes all source text and only
              // reintroduces a fixed, known-safe tag set (lib/articles/markdown.ts).
              dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(body) || "<p><em>Nothing to preview yet.</em></p>" }}
            />
          ) : (
            <textarea
              id="body"
              name="body"
              rows={16}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write in Markdown — headings (#), lists (-), **bold**, *italic*, [links](/path)."
              className={`${inputClass} mt-1 font-mono`}
            />
          )}
          {/* Preview mode still submits the current body via this hidden mirror. */}
          {showPreview && <input type="hidden" name="body" value={body} />}
        </div>

        <details className="rounded-md border border-veridan-warm-gray-light bg-white p-4">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
            SEO &amp; notes (optional)
          </summary>
          <div className="mt-4 space-y-4">
            <div>
              <label className={labelClass} htmlFor="seo_title">
                SEO title
              </label>
              <input
                id="seo_title"
                name="seo_title"
                defaultValue={article.seo_title ?? ""}
                placeholder={article.title || "Falls back to the article title"}
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="seo_description">
                SEO description
              </label>
              <textarea
                id="seo_description"
                name="seo_description"
                rows={2}
                defaultValue={article.seo_description ?? ""}
                placeholder="Falls back to the excerpt"
                className={`${inputClass} mt-1`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="source_notes">
                Source notes (internal — never shown publicly)
              </label>
              <textarea
                id="source_notes"
                name="source_notes"
                rows={2}
                defaultValue={article.source_notes ?? ""}
                className={`${inputClass} mt-1`}
              />
            </div>
          </div>
        </details>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? "Saving…" : "Save"}
          </button>
          {state.ok === false && (
            <p role="alert" className="text-xs text-red-600">
              {state.error}
            </p>
          )}
        </div>
      </form>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Hero image
        </h2>
        <HeroImageUploader articleId={article.id} currentImageUrl={heroImageUrl} />
      </section>

      <section className="mt-10">
        <AiAssistPanel
          articleId={article.id}
          hasExistingBody={body.trim().length > 0}
          onAccept={(text) => {
            setBody((current) => (current.trim() ? `${current}\n\n${text}` : text));
            setEverAiAssisted(true);
            setShowPreview(false);
          }}
        />
      </section>

      <section className="mt-10 border-t border-veridan-warm-gray-light pt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          LinkedIn
        </h2>
        <LinkedinCopyButton
          articleId={article.id}
          title={article.title}
          excerpt={article.excerpt}
          publicUrl={publicUrl}
          alreadyCrossPosted={article.linkedin_cross_posted}
        />
      </section>
    </div>
  );
}

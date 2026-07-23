"use client";

import { useActionState } from "react";
import { saveHeroImage, type ArticleActionResult } from "../../actions";

const initialResult: ArticleActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

export function HeroImageUploader({
  articleId,
  currentImageUrl,
}: {
  articleId: string;
  currentImageUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState<ArticleActionResult, FormData>(
    saveHeroImage.bind(null, articleId),
    initialResult
  );

  return (
    <div>
      {currentImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- admin-only preview of a Storage-hosted image; next/image's remote-pattern config isn't wired up for a per-article Supabase path.
        <img
          src={currentImageUrl}
          alt="Current hero image"
          className="mb-3 h-40 w-full rounded-md border border-veridan-warm-gray-light object-cover"
        />
      )}
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="hero_image"
          accept=".png,.jpg,.jpeg,.webp"
          required
          className={`${inputClass} max-w-xs file:mr-3 file:rounded-md file:border-0 file:bg-veridan-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:uppercase file:tracking-wide file:text-veridan-paper`}
        />
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Uploading…" : currentImageUrl ? "Replace image" : "Upload image"}
        </button>
      </form>
      {state.ok === false && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {state.error}
        </p>
      )}
    </div>
  );
}

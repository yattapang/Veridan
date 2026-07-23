"use client";

import { useActionState } from "react";
import { createArticle, type ArticleActionResult } from "../actions";

const initialResult: ArticleActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

export function NewArticleForm() {
  const [state, formAction, pending] = useActionState<ArticleActionResult, FormData>(
    createArticle,
    initialResult
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className={labelClass} htmlFor="title">
          Title
        </label>
        <input id="title" name="title" required autoFocus className={`${inputClass} mt-1`} />
      </div>

      <div>
        <label className={labelClass} htmlFor="source_notes">
          Drafting notes (optional)
        </label>
        <textarea
          id="source_notes"
          name="source_notes"
          rows={4}
          placeholder="What should this article cover? These notes can also be used by AI Assist in the editor."
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create draft"}
        </button>
        {state.ok === false && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

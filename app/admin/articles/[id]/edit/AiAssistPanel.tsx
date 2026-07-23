"use client";

import { useState, useTransition } from "react";
import { ARTICLE_AI_INSTRUCTIONS, type ArticleAiInstruction } from "@/lib/articles/aiDraftCore";
import { uploadAiSourceFile } from "../../actions";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";
const buttonClass =
  "rounded-md border border-veridan-warm-gray-light px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-ink transition-opacity duration-150 hover:opacity-80 disabled:opacity-50";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

const INSTRUCTION_LABELS: Record<ArticleAiInstruction, string> = {
  draft: "Draft — write a new article from these notes",
  expand: "Expand — add detail to the current body",
  rewrite: "Rewrite — improve the current body's clarity/flow",
};

/**
 * AI Assist panel (Plan §2.4): notes + instruction + optional spec-sheet
 * upload, calling the AI-draft endpoint. The proposal renders in this
 * DISTINCT staging panel with Accept/Discard — Accept only inserts the text
 * into the parent's body textarea via `onAccept`; it never saves anything
 * itself (GUARDRAIL, Plan §2.3/§2.6). Discard just clears this panel's
 * local state.
 */
export function AiAssistPanel({
  articleId,
  hasExistingBody,
  onAccept,
}: {
  articleId: string;
  hasExistingBody: boolean;
  onAccept: (text: string) => void;
}) {
  const [instruction, setInstruction] = useState<ArticleAiInstruction>("draft");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [proposal, setProposal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runDraft() {
    setError(null);
    setProposal(null);
    startTransition(async () => {
      try {
        let sourceFilePath: string | undefined;
        if (file) {
          const fd = new FormData();
          fd.set("source_file", file);
          const uploadResult = await uploadAiSourceFile(articleId, fd);
          if (!uploadResult.ok) {
            setError(uploadResult.error);
            return;
          }
          sourceFilePath = uploadResult.path;
        }

        const res = await fetch(`/api/articles/${articleId}/ai-draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instruction, notes, source_file_path: sourceFilePath }),
        });
        const json = (await res.json()) as { ok: boolean; text?: string; error?: string };
        if (!json.ok) {
          setError(json.error ?? "The AI draft request failed.");
          return;
        }
        setProposal(json.text ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "The AI draft request failed.");
      }
    });
  }

  return (
    <div className="rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale p-5">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
        AI Assist
      </h3>
      <p className="mb-4 text-xs text-veridan-warm-gray">
        Generates a proposal only — it is never saved automatically. Review it below, then Accept
        to insert it into the body (still not saved) or Discard.
      </p>

      <div className="space-y-3">
        <div>
          <label className={labelClass} htmlFor="ai-instruction">
            Instruction
          </label>
          <select
            id="ai-instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value as ArticleAiInstruction)}
            className={`${inputClass} mt-1`}
          >
            {ARTICLE_AI_INSTRUCTIONS.map((i) => (
              <option key={i} value={i} disabled={i !== "draft" && !hasExistingBody}>
                {INSTRUCTION_LABELS[i]}
                {i !== "draft" && !hasExistingBody ? " (no body yet)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="ai-notes">
            Notes / instructions for this draft
          </label>
          <textarea
            id="ai-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="What should this article cover? Any facts, angle, or audience to keep in mind."
            className={`${inputClass} mt-1`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="ai-source-file">
            Attach a spec sheet / reference document (optional)
          </label>
          <input
            id="ai-source-file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={`${inputClass} mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-veridan-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:uppercase file:tracking-wide file:text-veridan-paper`}
          />
        </div>

        <button type="button" onClick={runDraft} disabled={pending} className={primaryButtonClass}>
          {pending ? "Generating…" : "Generate proposal"}
        </button>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      {proposal !== null && (
        <div className="mt-5 rounded-md border border-veridan-accent bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Proposal
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-sm text-veridan-ink">
            {proposal}
          </pre>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => {
                onAccept(proposal);
                setProposal(null);
              }}
            >
              Accept — insert into body
            </button>
            <button type="button" className={buttonClass} onClick={() => setProposal(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

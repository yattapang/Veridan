import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ARTICLE_AI_MODEL,
  buildArticleAiSystemPrompt,
  buildArticleAiUserText,
  parseArticleAiResponse,
  type ArticleAiContext,
  type ArticleAiInstruction,
} from "./aiDraftCore";
// Reusing the price-extraction pipeline's file classifier (Plan brief:
// "reuse, don't reinvent") — an uploaded spec sheet is the same
// PDF/image/CSV/unknown shape as a supplier price file.
import { classifyExtractionFile } from "@/lib/price-extraction/extraction-core";
import type { ArticleRow } from "@/lib/supabase/types";

/**
 * Phase 3B Task 66 — AI-draft orchestration (Plan §2.3), directly modeled on
 * lib/price-extraction/extract.ts's shape: Anthropic client construction, an
 * ANTHROPIC_API_KEY guard with a founder-readable message, and a defensive
 * response parse. Server-only.
 *
 * GUARDRAIL (Plan §2.3, load-bearing — Layer 2 review checks this
 * explicitly): this function writes ONLY to article_ai_draft_log. It never
 * touches articles.body or articles.status, under any code path, success or
 * failure. The proposed text is returned to the caller (the API route) so
 * the editor's client component can stage it for an explicit founder
 * Accept/Discard — never an auto-save.
 */

export const MISSING_API_KEY_MESSAGE =
  "Add ANTHROPIC_API_KEY to .env.local and Vercel env vars, then try AI Assist again.";

export type RunArticleAiDraftResult =
  | { ok: true; logId: string; text: string }
  | { ok: false; error: string };

interface RunArticleAiDraftInput {
  instruction: ArticleAiInstruction;
  notes: string;
  /** Storage path in the private article-source-uploads bucket, if a spec sheet was attached. */
  sourceFilePath?: string | null;
}

export async function runArticleAiDraft(
  supabase: SupabaseClient,
  articleId: string,
  input: RunArticleAiDraftInput,
  userId: string | null
): Promise<RunArticleAiDraftResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: MISSING_API_KEY_MESSAGE };
  }

  // 1. Load the article for prompt context (title/category/excerpt/body).
  const { data: article, error: loadError } = await supabase
    .from("articles")
    .select("id, title, category, excerpt, body")
    .eq("id", articleId)
    .maybeSingle<Pick<ArticleRow, "id" | "title" | "category" | "excerpt" | "body">>();

  if (loadError) return { ok: false, error: `Could not load the article: ${loadError.message}` };
  if (!article) return { ok: false, error: "Article not found." };

  // 2. Build the optional source-document content block.
  const userContent: Anthropic.ContentBlockParam[] = [];
  let hasSourceDocument = false;

  if (input.sourceFilePath) {
    const { data: blob, error: dlError } = await supabase.storage
      .from("article-source-uploads")
      .download(input.sourceFilePath);
    if (dlError || !blob) {
      return {
        ok: false,
        error: `Could not download the attached source file${dlError ? `: ${dlError.message}` : ""}.`,
      };
    }

    const info = classifyExtractionFile(input.sourceFilePath);
    if (info.kind === "pdf") {
      const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      userContent.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      });
      hasSourceDocument = true;
    } else if (info.kind === "image") {
      const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: info.mediaType as "image/png" | "image/jpeg" | "image/webp",
          data: base64,
        },
      });
      hasSourceDocument = true;
    } else if (info.kind === "csv") {
      const text = await blob.text();
      userContent.push({ type: "text", text: `Attached reference file (CSV):\n\n${text}` });
      hasSourceDocument = true;
    } else {
      return {
        ok: false,
        error: "The attached source file type isn't supported for AI Assist — upload a PDF, CSV, or an image (.png/.jpg/.jpeg/.webp).",
      };
    }
  }

  const ctx: ArticleAiContext = {
    title: article.title,
    category: article.category,
    excerpt: article.excerpt,
    existingBody: article.body,
    notes: input.notes,
    hasSourceDocument,
  };
  userContent.push({ type: "text", text: buildArticleAiUserText(input.instruction, ctx) });

  // 3. Call Claude.
  const client = new Anthropic();
  let responseText: string;
  try {
    const message = await client.messages.create({
      model: ARTICLE_AI_MODEL,
      max_tokens: 4000,
      system: buildArticleAiSystemPrompt(),
      messages: [{ role: "user", content: userContent }],
    });
    responseText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return {
      ok: false,
      error: `The AI-draft request to Claude failed: ${detail}. Check ANTHROPIC_API_KEY and your account's API access, then try again.`,
    };
  }

  // 4. Parse defensively.
  const parsed = parseArticleAiResponse(responseText);
  if (!parsed.ok) {
    return { ok: false, error: `The AI draft could not be read: ${parsed.error} Try again with different notes.` };
  }

  // 5. Log the call (GUARDRAIL: this is the ONLY table written here).
  const { data: logRow, error: logError } = await supabase
    .from("article_ai_draft_log")
    .insert({
      article_id: articleId,
      instruction: input.instruction,
      notes: input.notes,
      source_file_path: input.sourceFilePath ?? null,
      model: ARTICLE_AI_MODEL,
      response_text: parsed.text,
      created_by: userId,
    })
    .select("id")
    .single();

  if (logError || !logRow) {
    return {
      ok: false,
      error: `The AI draft was generated but could not be logged: ${logError?.message ?? "unknown error"}. The proposal below is NOT saved anywhere — copy it manually if you want to keep it, then try again.`,
    };
  }

  return { ok: true, logId: logRow.id as string, text: parsed.text };
}

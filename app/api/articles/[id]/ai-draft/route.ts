import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { isArticleAiInstruction } from "@/lib/articles/aiDraftCore";
import { runArticleAiDraft } from "@/lib/articles/aiDraft";

/**
 * Phase 3B Task 66 — `POST /api/articles/[id]/ai-draft` (Plan §2.3).
 * Body: `{ instruction: 'draft'|'expand'|'rewrite', notes: string,
 * source_file_path?: string }`. Founder-authenticated only (getCurrentUser
 * guard, same as every admin mutation in this app); the request-scoped,
 * RLS-enforced client is used throughout — no service-role client.
 *
 * GUARDRAIL (Plan §2.3, load-bearing): this route returns a proposal; it
 * never writes articles.body or articles.status. The only database write on
 * this path is the article_ai_draft_log insert inside runArticleAiDraft.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: articleId } = await context.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "You must be signed in." }, { status: 401 });
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const { instruction, notes, source_file_path } = body as Record<string, unknown>;

  if (!isArticleAiInstruction(instruction)) {
    return NextResponse.json(
      { ok: false, error: "instruction must be one of: draft, expand, rewrite." },
      { status: 400 }
    );
  }
  const notesText = typeof notes === "string" ? notes : "";
  const sourceFilePath = typeof source_file_path === "string" && source_file_path ? source_file_path : null;

  const result = await runArticleAiDraft(
    supabase,
    articleId,
    { instruction, notes: notesText, sourceFilePath },
    user.id
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({ ok: true, logId: result.logId, text: result.text });
}

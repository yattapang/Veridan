/**
 * GET /api/catalogue/[id]/thumbnail — same §3.3-gated pattern as
 * /api/catalogue/[id]/download, for a document's optional cover image. The
 * thumbnail lives in the SAME private `catalogue-files` bucket as the
 * document itself (Plan §3.2 — no separate public bucket), so it needs the
 * identical live visibility re-check, not a shortcut. See
 * lib/catalogue/gatedDownload.ts for the shared guardrail logic.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signPublicCatalogueAsset } from "@/lib/catalogue/gatedDownload";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Supabase is not configured." },
      { status: 500 }
    );
  }

  const result = await signPublicCatalogueAsset(admin, id, "thumbnail");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.redirect(result.url, { status: 302 });
}

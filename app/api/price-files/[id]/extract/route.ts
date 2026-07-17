/**
 * POST /api/price-files/[id]/extract — Phase 2B Task 37 extraction pipeline.
 *
 * Founder-session-only, exactly like GET /api/quotes/[id]/pdf (getCurrentUser,
 * used the same way app/admin/layout.tsx does) — extraction spends the
 * founders' Claude API budget and writes cost-side library data, so it must not
 * be reachable unauthenticated even via a guessed URL.
 *
 * All extraction/matching/persistence logic lives in lib/price-extraction/
 * (extract.ts orchestration over the pure extraction-core.ts + matching.ts) —
 * this route is auth + response framing only.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { runExtraction } from "@/lib/price-extraction/extract";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  }

  const result = await runExtraction(supabase, id);
  if (!result.ok) {
    // The pipeline already recorded extraction_status='failed' + a
    // founder-readable error_message; surface the same message to the caller.
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    lineCount: result.lineCount,
    confidentCount: result.confidentCount,
    needsReviewCount: result.needsReviewCount,
  });
}

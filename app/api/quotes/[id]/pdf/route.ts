/**
 * GET /api/quotes/[id]/pdf — server-rendered client-facing quote PDF
 * (Task 18). Founder-session-only (same auth as every /admin/* page — see
 * lib/auth.ts getCurrentUser, used the identical way app/admin/layout.tsx
 * does), since this returns a document with client pricing that should not
 * be reachable unauthenticated even via a guessed/leaked URL.
 *
 * All query/transform/render logic lives in lib/quotes/pdf.ts (extracted in
 * Task 19 so the send flow can reuse the exact same PDF buffer for its
 * Resend attachment + Storage artifact) — this route is now just auth +
 * response framing.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { renderQuotePdf } from "@/lib/quotes/pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const result = await renderQuotePdf(supabase, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.quoteRef}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

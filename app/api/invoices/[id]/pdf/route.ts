/**
 * GET /api/invoices/[id]/pdf — server-rendered invoice PDF (Task 48b).
 * Founder-session-only, same auth pattern as app/api/quotes/[id]/pdf/route.ts
 * (getCurrentUser, mirroring every /admin/* page's auth gate) — invoices
 * carry client pricing and should never be reachable unauthenticated, even
 * via a guessed/leaked URL.
 *
 * All query/transform/render logic lives in lib/invoices/pdf.ts (reused by
 * the send flow in app/admin/invoices/[id]/actions.ts), so there is exactly
 * one place that turns an invoice id into a PDF buffer.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { renderInvoicePdf } from "@/lib/invoices/pdf";

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

  const result = await renderInvoicePdf(supabase, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.invoiceNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

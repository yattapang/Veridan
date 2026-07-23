/**
 * GET /api/catalogue/[id]/download — THE §3.3 gated route (Plan §3.3,
 * "GET /api/catalogue/[id]/download"). Deliberately UNAUTHENTICATED — this
 * is the public-facing link every catalogue browse card points to (Plan
 * §3.5: "each listed document link routes through the gated download
 * endpoint, never a direct Storage URL"). Founders previewing from the
 * admin list use a separately-signed URL instead (lib/storage.ts's
 * signCatalogueFileUrl, generated with their own authenticated session).
 *
 * All of the actual guardrail logic — the live visibility re-check via the
 * service-role client, the 404-not-403 non-enumeration posture — lives in
 * lib/catalogue/gatedDownload.ts, shared with the thumbnail route below so
 * the two can never drift apart.
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

  const result = await signPublicCatalogueAsset(admin, id, "file");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.redirect(result.url, { status: 302 });
}

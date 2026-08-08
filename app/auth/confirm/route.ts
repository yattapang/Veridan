import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Email-link callback for invites and password resets.
 *
 * MECHANICS (verified against the installed SDK, node_modules/@supabase/auth-js
 * — GoTrueClient.verifyOtp accepts `VerifyTokenHashParams { token_hash, type }`,
 * and GoTrueAdminApi.inviteUserByEmail documents that "PKCE is not supported
 * when using inviteUserByEmail ... the browser initiating the invite is often
 * different from the browser accepting the invite"):
 *
 *   Supabase email template →  /auth/confirm?token_hash=…&type=invite|recovery&next=…
 *   this route              →  supabase.auth.verifyOtp({ token_hash, type })
 *                              which sets the auth cookies via the SSR client
 *   redirect                →  /auth/set-password (a real session now exists)
 *
 * Doing the exchange SERVER-side is what makes this work for a link opened in a
 * different browser from the one that triggered it — there is no PKCE code
 * verifier to find. /auth/set-password additionally accepts the default
 * templates' implicit-flow `#access_token` hash, so both template styles work.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const nextParam = url.searchParams.get("next");

  // Same-origin relative paths only — never follow an absolute URL from a link.
  const next =
    nextParam?.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/auth/set-password";

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      new URL("/auth/set-password?error=missing_token", url.origin)
    );
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.redirect(
      new URL("/auth/set-password?error=not_configured", url.origin)
    );
  }

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/auth/set-password?error=${encodeURIComponent(error.message)}`,
        url.origin
      )
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every matched request and
 * protects /admin/* — unauthenticated users are redirected to /login.
 * Standard @supabase/ssr middleware pattern, renamed to Next 16's `proxy`
 * convention (Task 26 — middleware.ts is deprecated in Next 16, renamed to
 * proxy.ts; functionality is identical per node_modules/next/dist/docs/
 * 01-app/01-getting-started/16-proxy.md: "Middleware is now called Proxy
 * to better reflect its purpose. The functionality remains the same.").
 *
 * IMPORTANT (per the same docs, "Execution order" section): Server
 * Functions (`"use server"` actions) are NOT separate routes proxy can
 * gate — a proxy matcher change can silently stop covering an action
 * route. This proxy's own auth check is optimistic-redirect-only (UX), not
 * the security boundary for admin mutations; every admin server action
 * re-checks `getCurrentUser()` itself (see app/admin/**\/actions.ts) as the
 * real guard, exactly as the docs recommend.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured yet (e.g. local build without env),
  // skip auth handling entirely so the app still builds/runs.
  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and
  // supabase.auth.getUser() — it can cause hard-to-debug logout issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith("/admin")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and images.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

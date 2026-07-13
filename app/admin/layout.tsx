import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { SignOutButton } from "@/components/admin/SignOutButton";

// Every /admin/* page is authenticated, cookie-dependent content — never
// statically prerender it (also avoids a build-time crash when Supabase
// env vars aren't configured, e.g. this repo before a project is wired up).
export const dynamic = "force-dynamic";

/**
 * Authenticated admin shell (Task 5). Middleware already protects
 * `/admin/*` (see middleware.ts), but this layout re-checks auth
 * server-side as defense-in-depth — the middleware matcher or a future
 * refactor could otherwise silently leave a route unprotected.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-veridan-paper text-veridan-ink">
      <aside className="hidden w-56 shrink-0 border-r border-veridan-warm-gray-light bg-veridan-paper px-4 py-6 md:flex md:flex-col md:justify-between">
        <div>
          <div className="mb-8 px-3">
            <p className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">
              Veridan
            </p>
            <p className="text-xs text-veridan-warm-gray">Admin</p>
          </div>
          <AdminSidebar />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-veridan-warm-gray-light bg-veridan-paper px-6 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-veridan-ink">
              {user.display_name || user.email}
            </p>
            {user.display_name && (
              <p className="truncate text-xs text-veridan-warm-gray">
                {user.email}
              </p>
            )}
          </div>
          <SignOutButton />
        </header>

        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}

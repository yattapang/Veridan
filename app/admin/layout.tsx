import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { SignOutButton } from "@/components/admin/SignOutButton";

// Every /admin/* page is authenticated, cookie-dependent content — never
// statically prerender it (also avoids a build-time crash when Supabase
// env vars aren't configured, e.g. this repo before a project is wired up).
export const dynamic = "force-dynamic";

/**
 * Authenticated admin shell (Task 5). This layout's server-side
 * `getCurrentUser()` check is the single authoritative auth gate for every
 * `/admin/*` route (there is no middleware/proxy layer — an earlier comment
 * referenced one that does not exist; Phase 3C review MINOR-1). Because
 * `force-dynamic` above runs this on every request and Server Actions each
 * re-check `getCurrentUser()` independently, this one gate is sufficient;
 * keep it here and do not assume any other layer protects admin routes.
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

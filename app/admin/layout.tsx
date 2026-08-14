import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { normalizeRole } from "@/lib/roles/matrix";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminMobileNav } from "@/components/admin/AdminMobileNav";
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
 *
 * ROLES (founder / staff): this layout gates AUTHENTICATION for every /admin
 * route and nothing more. AUTHORIZATION is per-area, because most of /admin is
 * open to both roles — each founder-only area carries its own `layout.tsx`
 * calling `requireFounderPage()` (app/admin/{parameters,invoices,expenses,
 * reports,overrides,suppliers,team}/layout.tsx), each founder-only Server Action
 * and export route re-checks the role itself, and the sidebar below filters its
 * links through the same matrix for presentation only. Do not "simplify" this
 * into a single role check here — it would either lock staff out of the whole
 * admin or, far worse, imply a protection that per-page code no longer performs.
 *
 * A locked-out or removed user resolves to null from `getCurrentUser()`, so the
 * redirect below is also what makes deactivation take effect immediately.
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

  const role = normalizeRole(user.role);

  return (
    <div className="flex min-h-screen bg-veridan-paper text-veridan-ink">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-veridan-warm-gray-light bg-veridan-paper md:sticky md:top-0 md:flex md:h-screen">
        <div className="shrink-0 px-4 pt-6 pb-2">
          <div className="mb-8 px-3">
            <p className="text-sm font-semibold uppercase tracking-wide text-veridan-ink">
              Veridan
            </p>
            <p className="text-xs text-veridan-warm-gray">Admin</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <AdminSidebar role={role} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-veridan-warm-gray-light bg-veridan-paper px-4 py-4 md:px-6">
          <div className="flex min-w-0 items-center gap-1">
            <AdminMobileNav role={role} />
            <div className="min-w-0">
              <Link
                href="/admin/account"
                className="truncate text-sm font-medium text-veridan-ink hover:underline hover:underline-offset-2"
              >
                {user.display_name || user.email}
              </Link>
              <p className="truncate text-xs text-veridan-warm-gray">
                {role === "founder" ? "Founder" : "Staff"}
                {user.display_name ? ` · ${user.email}` : ""}
              </p>
            </div>
          </div>
          <SignOutButton />
        </header>

        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}

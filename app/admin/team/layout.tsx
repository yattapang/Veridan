import { requireFounderPage } from "@/lib/roles/guards";

/**
 * Founder-only gate for /admin/team and everything nested under it.
 *
 * Enforcement layer (a). Putting the check in a layout rather than in the page
 * means a future sub-route under /admin/team is covered the moment it is
 * created — it cannot forget the guard. Layers (b) and (c) are the per-action
 * re-checks in ./actions.ts and the sidebar filtering in AdminSidebar.tsx.
 */
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  await requireFounderPage("team");
  return <>{children}</>;
}

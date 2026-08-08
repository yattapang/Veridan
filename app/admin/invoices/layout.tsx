import { requireFounderPage } from "@/lib/roles/guards";

/**
 * Founder-only gate for /admin/invoices and every route nested under it.
 *
 * Enforcement layer (a) — see lib/roles/guards.ts. A layout (rather than a
 * per-page check) means any sub-page added here later is covered the moment it
 * exists. The server actions and export routes under this area re-check the
 * role independently; this gate is not what protects them.
 */
export default async function InvoicesLayout({ children }: { children: React.ReactNode }) {
  await requireFounderPage("invoices");
  return <>{children}</>;
}

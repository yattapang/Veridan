import Link from "next/link";

export const metadata = {
  title: "Dashboard",
};

/**
 * Minimal placeholder so /admin renders (Task 5). The real dashboard —
 * pipeline snapshot, KPI tiles, recent activity — is assembled in Task 21
 * once the pipeline view (Task 20) exists.
 */
export default function AdminDashboardPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Dashboard</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        The pipeline snapshot and KPI tiles are coming in Task 21, once the
        pipeline view (Task 20) is built.
      </p>
      <p className="mt-6 text-sm text-veridan-ink">
        In the meantime, business parameters are ready for review at{" "}
        <Link
          href="/admin/parameters"
          className="font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
        >
          /admin/parameters
        </Link>
        .
      </p>
    </div>
  );
}

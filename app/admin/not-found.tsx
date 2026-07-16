import Link from "next/link";

/** 404 page for /admin routes (Task 26) — e.g. a stale/deleted quote link. */
export default function AdminNotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center text-veridan-ink">
      <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
        Veridan Admin
      </p>
      <h1 className="mt-3 text-xl font-semibold">Not found</h1>
      <p className="mt-3 max-w-md text-sm text-veridan-warm-gray">
        This record doesn&apos;t exist, or may have been deleted.
      </p>
      <div className="mt-8">
        <Link
          href="/admin"
          className="rounded-md bg-veridan-ink px-5 py-2.5 text-sm font-medium text-veridan-paper hover:bg-veridan-ink-soft"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

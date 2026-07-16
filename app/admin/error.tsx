"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary for every route under /admin (Task 26 production
 * hardening). Founder-facing but still never surfaces the raw error
 * message/stack — Supabase/Postgres errors can leak column/table names,
 * which is more detail than a UI toast should carry even to a trusted
 * user. The real message goes to the server console with a greppable
 * prefix for Vercel logs.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[veridan:admin-error]", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center text-veridan-ink">
      <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
        Veridan Admin
      </p>
      <h1 className="mt-3 text-xl font-semibold">Something went wrong</h1>
      <p className="mt-3 max-w-md text-sm text-veridan-warm-gray">
        This page hit an unexpected error. Your data has not been changed.
        {error.digest ? (
          <>
            {" "}
            Reference: <span className="font-mono">{error.digest}</span>
          </>
        ) : null}
      </p>
      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-veridan-ink px-5 py-2.5 text-sm font-medium text-veridan-paper hover:bg-veridan-ink-soft"
        >
          Try again
        </button>
        <Link
          href="/admin"
          className="rounded-md border border-veridan-line px-5 py-2.5 text-sm font-medium text-veridan-ink hover:bg-veridan-warm-gray-pale"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

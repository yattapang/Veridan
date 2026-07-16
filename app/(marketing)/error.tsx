"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary for every route under the (marketing) group — public
 * marketing pages and the quote-request portal (Task 26 production
 * hardening). Client Component per the App Router error.tsx contract.
 * Never renders the raw error message/stack to the visitor; logs it
 * server-console-side (visible in Vercel logs) with a greppable prefix.
 */
export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[veridan:marketing-error]", error.digest ?? "", error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center bg-veridan-paper px-6 py-24 text-center text-veridan-ink">
      <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
        Veridan
      </p>
      <h1 className="mt-3 text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-3 max-w-md text-sm text-veridan-warm-gray">
        We hit a snag loading this page. Please try again, or head back to
        the homepage — nothing you submitted has been lost.
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
          href="/"
          className="rounded-md border border-veridan-line px-5 py-2.5 text-sm font-medium text-veridan-ink hover:bg-veridan-warm-gray-pale"
        >
          Back to homepage
        </Link>
      </div>
    </main>
  );
}

import Link from "next/link";

/**
 * Root-level 404 (Task 26). Route groups like (marketing) and admin's own
 * not-found.tsx cover most paths, but Next.js still needs a top-level
 * not-found.tsx for any URL that doesn't match a segment at all (e.g. a
 * typo'd path outside every group) — this is that backstop.
 */
export default function RootNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-veridan-paper px-6 py-24 text-center text-veridan-ink">
      <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
        Veridan
      </p>
      <h1 className="mt-3 text-2xl font-semibold">Page not found</h1>
      <p className="mt-3 max-w-md text-sm text-veridan-warm-gray">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <div className="mt-8">
        <Link
          href="/"
          className="rounded-md bg-veridan-ink px-5 py-2.5 text-sm font-medium text-veridan-paper hover:bg-veridan-ink-soft"
        >
          Back to homepage
        </Link>
      </div>
    </main>
  );
}

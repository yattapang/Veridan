import Link from "next/link";

/** 404 page for public marketing + quote-request portal routes (Task 26). */
export default function MarketingNotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center bg-veridan-paper px-6 py-24 text-center text-veridan-ink">
      <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">
        Veridan
      </p>
      <h1 className="mt-3 text-2xl font-semibold">Page not found</h1>
      <p className="mt-3 max-w-md text-sm text-veridan-warm-gray">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/"
          className="rounded-md bg-veridan-ink px-5 py-2.5 text-sm font-medium text-veridan-paper hover:bg-veridan-ink-soft"
        >
          Back to homepage
        </Link>
        <Link
          href="/contact"
          className="rounded-md border border-veridan-line px-5 py-2.5 text-sm font-medium text-veridan-ink hover:bg-veridan-warm-gray-pale"
        >
          Contact us
        </Link>
      </div>
    </main>
  );
}

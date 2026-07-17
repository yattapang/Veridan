"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptAllConfident } from "./actions";

/** Task 39 "Bulk accept all confident" — existing-product matches only (see review.ts). */
export function AcceptAllButton({ uploadId, count }: { uploadId: string; count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (count === 0) return null;

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await acceptAllConfident(uploadId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Accepting…" : `Accept all confident (${count})`}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

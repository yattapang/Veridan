"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Client trigger for POST /api/price-files/[id]/extract (Task 37). Appears for
 * uploads in `pending` or `failed` status; on success it refreshes the server
 * component so the new `extracting`/`review`/`failed` state renders. The heavy
 * lifting (Claude call + matching + persistence) is all server-side in the
 * route handler — this only kicks it off and reflects the result.
 */
export function RunExtractionButton({ uploadId, label }: { uploadId: string; label: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = running || isPending;

  async function run() {
    setError(null);
    setRunning(true);
    try {
      const res = await fetch(`/api/price-files/${uploadId}/extract`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "Extraction failed. Please try again.");
      } else {
        startTransition(() => router.refresh());
      }
    } catch {
      setError("Could not reach the extraction service. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Extracting…" : label}
      </button>
      {busy && (
        <span className="text-xs text-veridan-warm-gray">
          Sending the file to Claude and matching line items — this can take a moment.
        </span>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

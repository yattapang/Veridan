"use client";

import { useState, useTransition } from "react";
import { ENQUIRY_STATUSES, type EnquiryStatus } from "@/lib/supabase/types";
import { updateEnquiryStatus } from "../actions";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  reviewing: "Reviewing",
  converted: "Converted",
  discarded: "Discarded",
};

/** Manual status transitions (Task 13). Converted is set only by the convert flow. */
export function StatusForm({ enquiryId, status }: { enquiryId: string; status: EnquiryStatus }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const selectableStatuses = ENQUIRY_STATUSES.filter((s) => s !== "converted" || s === status);

  function handleChange(next: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateEnquiryStatus(enquiryId, next as EnquiryStatus);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray" htmlFor="status-select">
        Status
      </label>
      <select
        id="status-select"
        value={status}
        disabled={pending || status === "converted"}
        onChange={(e) => handleChange(e.target.value)}
        className="mt-1 w-full max-w-xs rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none disabled:opacity-60"
      >
        {selectableStatuses.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s] ?? s}
          </option>
        ))}
      </select>
      {status === "converted" && (
        <p className="mt-1 text-xs text-veridan-warm-gray">
          Converted enquiries stay converted — see the linked project.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import type { SupplierRow } from "@/lib/supabase/types";
import { setSupplierActive } from "./actions";
import { SupplierForm } from "./SupplierForm";

export function SupplierListItem({ supplier }: { supplier: SupplierRow }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleActive() {
    setError(null);
    startTransition(async () => {
      const result = await setSupplierActive(supplier.id, !supplier.active);
      if (!result.ok) setError(result.error);
    });
  }

  if (editing) {
    return (
      <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
        <SupplierForm supplier={supplier} onSaved={() => setEditing(false)} />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2 text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
        >
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-veridan-warm-gray-light py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-veridan-ink">{supplier.name}</p>
          {!supplier.active && (
            <span className="rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray">
              Archived
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          {[supplier.country, supplier.origin_region].filter(Boolean).join(" · ") || "No origin set"}
          {" · "}
          {supplier.default_currency}
          {supplier.default_lead_time_text ? ` · ${supplier.default_lead_time_text}` : ""}
        </p>
        {supplier.notes && <p className="mt-1 text-xs text-veridan-ink/70">{supplier.notes}</p>}
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={toggleActive}
          disabled={pending}
          className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink disabled:opacity-50"
        >
          {pending ? "Saving…" : supplier.active ? "Archive" : "Restore"}
        </button>
      </div>
    </li>
  );
}

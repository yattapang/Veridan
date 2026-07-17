"use client";

import { useMemo, useState, useTransition } from "react";
import type { ItemGroupWithProductCount } from "@/lib/supabase/types";
import { validateMergeSelection } from "@/lib/item-groups";
import { mergeItemGroups } from "./actions";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Merge UI (Task 30, plan §1.5): "if staff create two groups for what
 * turns out to be the same item, a merge operation re-points
 * products.item_group_id for the losing group's members rather than
 * requiring manual re-entry." A native confirm() dialog states exactly how
 * many products move before the destructive part (deleting the losing
 * group) runs, per the plan's explicit UAT requirement.
 */
export function MergeForm({ itemGroups }: { itemGroups: ItemGroupWithProductCount[] }) {
  const [survivingId, setSurvivingId] = useState("");
  const [losingId, setLosingId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const survivingGroup = itemGroups.find((g) => g.id === survivingId) ?? null;
  const losingGroup = itemGroups.find((g) => g.id === losingId) ?? null;
  const losingCount = losingGroup?.products?.[0]?.count ?? 0;

  const validation = useMemo(() => validateMergeSelection(survivingId, losingId), [survivingId, losingId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    const confirmed = window.confirm(
      `Merge "${losingGroup?.family_name}" into "${survivingGroup?.family_name}"? ` +
        `${losingCount} product${losingCount === 1 ? "" : "s"} will move to the surviving group, and ` +
        `"${losingGroup?.family_name}" will be deleted. This is logged and cannot be undone automatically.`
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await mergeItemGroups(survivingId, losingId, reason);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSurvivingId("");
      setLosingId("");
      setReason("");
      setDone(true);
    });
  }

  if (itemGroups.length < 2) {
    return (
      <p className="text-xs text-veridan-warm-gray">
        Create at least two item groups before you can merge.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className={labelClass} htmlFor="merge-losing">
          Merge this group…
        </label>
        <select
          id="merge-losing"
          value={losingId}
          onChange={(e) => setLosingId(e.target.value)}
          className={`${inputClass} mt-1`}
        >
          <option value="">Choose…</option>
          {itemGroups.map((g) => (
            <option key={g.id} value={g.id} disabled={g.id === survivingId}>
              {g.family_name}
              {g.grade ? ` (${g.grade})` : ""} — {g.products?.[0]?.count ?? 0} product
              {(g.products?.[0]?.count ?? 0) === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="merge-surviving">
          …into this group
        </label>
        <select
          id="merge-surviving"
          value={survivingId}
          onChange={(e) => setSurvivingId(e.target.value)}
          className={`${inputClass} mt-1`}
        >
          <option value="">Choose…</option>
          {itemGroups.map((g) => (
            <option key={g.id} value={g.id} disabled={g.id === losingId}>
              {g.family_name}
              {g.grade ? ` (${g.grade})` : ""}
            </option>
          ))}
        </select>
      </div>

      {losingGroup && survivingGroup && (
        <p className="sm:col-span-2 text-xs text-veridan-warm-gray">
          This moves {losingCount} product{losingCount === 1 ? "" : "s"} from &quot;{losingGroup.family_name}&quot;
          into &quot;{survivingGroup.family_name}&quot;, then deletes &quot;{losingGroup.family_name}&quot;.
        </p>
      )}

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="merge-reason">
          Reason (optional, recorded in the merge audit log)
        </label>
        <input
          id="merge-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Duplicate entry, same physical item"
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !validation.ok}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Merging…" : "Merge groups"}
        </button>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
        {done && !error && <p className="text-xs text-veridan-warm-gray">Merged.</p>}
      </div>
    </form>
  );
}

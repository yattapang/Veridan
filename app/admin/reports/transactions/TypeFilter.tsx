import Link from "next/link";
import { TRANSACTION_TYPE_LABELS, TRANSACTION_TYPES, type TransactionType } from "@/lib/reports/transactions";

/**
 * Transaction-type filter chips.
 *
 * Links rather than checkboxes, for the same reason the basis toggle is:
 * the selection lives in the URL, so it is bookmarkable and the export
 * buttons on this page carry exactly what is on screen into the download.
 * Clicking an active chip removes it; clicking "All types" clears the filter
 * entirely.
 */
export function TypeFilter({
  selected,
  startIso,
  endIso,
}: {
  selected: TransactionType[];
  startIso: string;
  endIso: string;
}) {
  function hrefFor(types: TransactionType[]): string {
    const params = new URLSearchParams({ start: startIso, end: endIso });
    for (const t of types) params.append("type", t);
    return `/admin/reports/transactions?${params.toString()}`;
  }

  const chipBase =
    "rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors duration-150";
  const chipActive = "bg-veridan-ink text-veridan-paper";
  const chipIdle =
    "border border-veridan-warm-gray-light text-veridan-ink/70 hover:bg-veridan-warm-gray-pale hover:text-veridan-ink";

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Type</span>
      <Link href={hrefFor([])} className={`${chipBase} ${selected.length === 0 ? chipActive : chipIdle}`}>
        All types
      </Link>
      {TRANSACTION_TYPES.map((type) => {
        const active = selected.includes(type);
        const next = active ? selected.filter((t) => t !== type) : [...selected, type];
        return (
          <Link key={type} href={hrefFor(next)} className={`${chipBase} ${active ? chipActive : chipIdle}`}>
            {TRANSACTION_TYPE_LABELS[type]}
          </Link>
        );
      })}
    </div>
  );
}

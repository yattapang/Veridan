/**
 * Shared date-range filter form for both report pages (Task 54). Plain GET
 * form (no client JS needed) — mirrors the picker filter form pattern in
 * app/admin/quotes/[id]/page.tsx.
 */
export function DateRangeFilter({ startIso, endIso }: { startIso: string; endIso: string }) {
  const inputClass =
    "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
  const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

  return (
    <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
      <div>
        <label className={labelClass} htmlFor="start">
          From
        </label>
        <input id="start" type="date" name="start" defaultValue={startIso} className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="end">
          To
        </label>
        <input id="end" type="date" name="end" defaultValue={endIso} className={`${inputClass} mt-1`} />
      </div>
      <button
        type="submit"
        className="shrink-0 rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90"
      >
        Apply
      </button>
      <p className="w-full text-xs text-veridan-warm-gray">Defaults to year-to-date (Jamaica local time).</p>
    </form>
  );
}

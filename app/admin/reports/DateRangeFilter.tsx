/**
 * Shared date-range filter form for the report pages (Task 54). Plain GET
 * form (no client JS needed) — mirrors the picker filter form pattern in
 * app/admin/quotes/[id]/page.tsx.
 *
 * `preserve` carries any OTHER query parameter the page is currently on
 * through the submit as a hidden field — the reporting basis on the income
 * statement, the type filter on the transaction ledger. A plain GET form
 * replaces the whole query string, so without this, applying a date range
 * would silently reset a founder's cash-basis view back to accrual.
 */
export function DateRangeFilter({
  startIso,
  endIso,
  preserve,
}: {
  startIso: string;
  endIso: string;
  preserve?: Record<string, string | string[] | undefined>;
}) {
  const inputClass =
    "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
  const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

  const hidden: { name: string; value: string }[] = Object.entries(preserve ?? {}).flatMap(([name, value]) => {
    if (value == null) return [];
    return (Array.isArray(value) ? value : [value]).map((v) => ({ name, value: v }));
  });

  return (
    <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
      {hidden.map((field, i) => (
        <input key={`${field.name}-${i}`} type="hidden" name={field.name} value={field.value} />
      ))}
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

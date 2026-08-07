import type { ExpenseCategoryRow } from "@/lib/expenses/types";
import type { ExpensePaymentFilter } from "@/lib/expenses/expense";

/**
 * Plain GET filter form (no client JS), mirroring
 * app/admin/reports/DateRangeFilter.tsx. The date range matches on
 * `incurred_date` — the date an expense belongs to regardless of basis — so
 * filtering to January still surfaces an unpaid January bill, which is
 * exactly what a founder needs in order to go and pay it.
 */
export function ExpenseFilters({
  startIso,
  endIso,
  categoryId,
  payment,
  categories,
}: {
  startIso: string;
  endIso: string;
  categoryId: string;
  payment: ExpensePaymentFilter;
  categories: ExpenseCategoryRow[];
}) {
  const inputClass =
    "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
  const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

  return (
    <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
      <div>
        <label className={labelClass} htmlFor="start">
          From (incurred)
        </label>
        <input id="start" type="date" name="start" defaultValue={startIso} className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="end">
          To (incurred)
        </label>
        <input id="end" type="date" name="end" defaultValue={endIso} className={`${inputClass} mt-1`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="category">
          Category
        </label>
        <select id="category" name="category" defaultValue={categoryId} className={`${inputClass} mt-1`}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="payment">
          Status
        </label>
        <select id="payment" name="payment" defaultValue={payment} className={`${inputClass} mt-1`}>
          <option value="all">Paid and unpaid</option>
          <option value="paid">Paid only</option>
          <option value="unpaid">Unpaid only</option>
        </select>
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

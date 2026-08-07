import Link from "next/link";
import { REPORT_BASES, REPORT_BASIS_DESCRIPTIONS, REPORT_BASIS_LABELS, type ReportBasis } from "@/lib/reports/basis";

/**
 * The accrual/cash switch, shared by the income statement and the
 * transaction ledger.
 *
 * Rendered as two links rather than a form control so the chosen basis lives
 * in the URL: a founder can bookmark "the cash-basis Q3 statement", and the
 * export buttons on the same page carry the identical basis into the
 * download. A client-side toggle would put the two out of sync.
 *
 * `basePath` is what lets the ledger reuse this component and stay on its own
 * page; `preserve` carries any other filter that page is currently on (the
 * ledger's type chips) through a basis change, so flipping the basis never
 * silently widens the view.
 *
 * The active basis is spelled out underneath in full. This deliberately
 * takes vertical space — a statement whose basis is not obvious is the exact
 * problem this restructure exists to fix.
 */
export function BasisToggle({
  basis,
  startIso,
  endIso,
  basePath = "/admin/reports/pnl",
  preserve,
}: {
  basis: ReportBasis;
  startIso: string;
  endIso: string;
  basePath?: string;
  preserve?: Record<string, string[]>;
}) {
  return (
    <div className="rounded-md border border-veridan-warm-gray-light bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-veridan-warm-gray">Reporting basis</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {REPORT_BASES.map((option) => {
          const active = option === basis;
          const query = new URLSearchParams({ start: startIso, end: endIso, basis: option });
          for (const [name, values] of Object.entries(preserve ?? {})) {
            for (const value of values) query.append(name, value);
          }
          return (
            <Link
              key={option}
              href={`${basePath}?${query.toString()}`}
              aria-current={active ? "true" : undefined}
              className={`rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors duration-150 ${
                active
                  ? "bg-veridan-ink text-veridan-paper"
                  : "border border-veridan-warm-gray-light text-veridan-ink/70 hover:bg-veridan-warm-gray-pale hover:text-veridan-ink"
              }`}
            >
              {REPORT_BASIS_LABELS[option]}
            </Link>
          );
        })}
        <span className="rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray">
          {basis === "accrual" ? "default" : "cash movements only"}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-xs text-veridan-warm-gray">{REPORT_BASIS_DESCRIPTIONS[basis]}</p>
    </div>
  );
}

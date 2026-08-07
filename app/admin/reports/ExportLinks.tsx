/**
 * Export buttons for the report pages (Task 56). Plain anchors to the
 * auth-gated `/api/reports/<name>/export` route handlers, carrying the current
 * from/to range so the download matches what's on screen. `download` hints the
 * browser to save rather than navigate.
 */
export interface ExportLink {
  label: string;
  /** Route base, e.g. "/api/reports/pnl/export". The from/to query is appended. */
  href: string;
}

export function ExportLinks({
  links,
  startIso,
  endIso,
  extraQuery,
}: {
  links: ExportLink[];
  startIso: string;
  endIso: string;
  /**
   * Any additional report parameters the download must carry — the reporting
   * basis, the ledger's type filter. Without this a founder looking at a
   * cash-basis statement would download the accrual one, which is exactly
   * the kind of quiet mismatch this restructure exists to eliminate.
   */
  extraQuery?: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams({ from: startIso, to: endIso });
  for (const [key, value] of Object.entries(extraQuery ?? {})) {
    if (value == null) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  const query = `?${params.toString()}`;
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={link.href}
          href={`${link.href}${query}`}
          download
          className="rounded-md border border-veridan-warm-gray-light bg-white px-3 py-1.5 text-xs font-medium text-veridan-ink transition-opacity duration-150 hover:opacity-80"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

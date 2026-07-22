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
}: {
  links: ExportLink[];
  startIso: string;
  endIso: string;
}) {
  const query = `?from=${encodeURIComponent(startIso)}&to=${encodeURIComponent(endIso)}`;
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

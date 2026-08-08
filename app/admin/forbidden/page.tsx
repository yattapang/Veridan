import Link from "next/link";

export const metadata = {
  title: "Not available",
};

const AREA_LABELS: Record<string, string> = {
  parameters: "Parameters",
  invoices: "Invoices",
  expenses: "Expenses",
  reports: "Reports",
  overrides: "Overrides",
  suppliers: "Suppliers",
  team: "Team",
};

/**
 * Clean 403 for a staff member who reached a founder-only URL directly.
 *
 * The redirect happens BEFORE any founder-only page runs a single query, so
 * nothing about the data behind that URL — not a total, not a count, not a row —
 * is fetched, let alone rendered. This page states what happened plainly rather
 * than pretending the section does not exist, because a colleague who was told
 * "check the reports" needs to know to ask, not to think the app is broken.
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const rawArea = Array.isArray(params.area) ? params.area[0] : params.area;
  const costReason = (Array.isArray(params.reason) ? params.reason[0] : params.reason) === "costs";
  const label = rawArea ? AREA_LABELS[rawArea] ?? null : null;

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Not available to your account</h1>
      <p className="mt-3 text-sm text-veridan-warm-gray">
        {costReason
          ? "That page shows supplier costs, which are limited to founder accounts."
          : label
            ? `${label} is limited to founder accounts.`
            : "That section is limited to founder accounts."}
      </p>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Nothing is wrong — your account is a Staff account, which covers the day-to-day work:
        enquiries, companies, projects, quotes, orders, products and website content. Ask a founder
        if you need something from here.
      </p>
      <p className="mt-6">
        <Link
          href="/admin"
          className="text-sm font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
        >
          Back to the dashboard
        </Link>
      </p>
    </div>
  );
}

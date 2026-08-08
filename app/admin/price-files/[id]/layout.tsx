import { requireCostDetailPage } from "@/lib/roles/guards";

/**
 * Founder-only gate for a price file's detail page, its extraction, and its
 * review screen.
 *
 * The founder's brief allows staff into Price Files, but the no-supplier-costs
 * rule outranks an area allowance, so the split is drawn here: staff can see
 * and add to the price-file LIST (a supplier price list arrived, from whom,
 * what state it is in), while everything past that — the extraction counts, the
 * review table of unit costs, and seeding a quote from them — is founder work.
 * The DB agrees: extracted_prices RLS requires is_founder().
 */
export default async function PriceFileDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireCostDetailPage();
  return <>{children}</>;
}

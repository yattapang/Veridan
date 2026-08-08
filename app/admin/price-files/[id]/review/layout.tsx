import { requireCostDetailPage } from "@/lib/roles/guards";

/**
 * Founder-only gate: this sub-view is the extracted supplier price list, one unit cost per row.
 *
 * It sits inside an area staff CAN otherwise reach, but there is nothing left of
 * the page once the cost columns are stripped, so it is gated whole rather than
 * field by field. See COST_DETAIL_ROUTES in lib/roles/matrix.ts — the same list
 * the unit tests assert against.
 */
export default async function PriceFileReviewLayout({ children }: { children: React.ReactNode }) {
  await requireCostDetailPage();
  return <>{children}</>;
}

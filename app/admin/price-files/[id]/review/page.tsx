import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import type {
  CompanyRow,
  CurrencyCode,
  ExtractedPriceRow,
  ItemGroupRow,
  PriceFileUploadWithDetails,
  ProjectWithCompany,
  SupplierRow,
} from "@/lib/supabase/types";
import { classifyMatchKind, computeUploadProgress, selectBulkAcceptableRowIds } from "@/lib/price-extraction/review";
import { SupplierGateForm } from "./SupplierGateForm";
import { AcceptAllButton } from "./AcceptAllButton";
import { ReviewRow, type ItemGroupMatchInfo, type MatchedProductInfo } from "./ReviewRow";
import { SeedQuoteForm } from "./SeedQuoteForm";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Review · Price File ${id}` };
}

interface ProductJoinRow {
  id: string;
  description: string;
  supplier_id: string | null;
  item_group_id: string | null;
  unit_cost: number;
  cost_currency: CurrencyCode;
  suppliers: { id: string; name: string } | null;
}

/**
 * Review screen for one price-file upload (Task 39, Plan §2.2 Stage 3):
 * every extracted line, its raw source text, the proposed cost-side values,
 * its match (existing product / item-group cross-supplier / new item), and
 * accept/edit/reject actions. Output paths (Tasks 40/41) are reached from
 * this screen's per-row accept action and the "Seed a quote" section below.
 */
export default async function PriceFileReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Review extraction</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  const { data: upload, error: uploadError } = await supabase
    .from("price_file_uploads")
    .select("*, suppliers(id, name), users(id, email, display_name)")
    .eq("id", id)
    .maybeSingle<PriceFileUploadWithDetails>();

  if (uploadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Review extraction</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The upload record couldn't be loaded (${uploadError.message}).`}
        />
      </div>
    );
  }
  if (!upload) notFound();

  const [{ data: rowsData }, { data: suppliersData }, { data: itemGroupsData }, { data: companiesData }, { data: projectsData }] =
    await Promise.all([
      supabase.from("extracted_prices").select("*").eq("price_file_upload_id", id).order("created_at"),
      supabase.from("suppliers").select("*").eq("active", true).order("name"),
      supabase.from("item_groups").select("*").order("family_name"),
      supabase.from("companies").select("*").order("name"),
      supabase.from("projects").select("*, companies(id, name)").eq("status", "active").order("name"),
    ]);

  const rows = (rowsData as ExtractedPriceRow[]) ?? [];
  const suppliers = (suppliersData as SupplierRow[]) ?? [];
  const itemGroups = (itemGroupsData as ItemGroupRow[]) ?? [];
  const companies = (companiesData as CompanyRow[]) ?? [];
  const projects = (projectsData as unknown as ProjectWithCompany[]) ?? [];

  const matchedProductIds = [...new Set(rows.map((r) => r.matched_product_id).filter((v): v is string => Boolean(v)))];
  const itemGroupIds = [
    ...new Set(rows.map((r) => r.item_group_match_id).filter((v): v is string => Boolean(v))),
  ];

  const [{ data: matchedProductsData }, { data: siblingProductsData }] = await Promise.all([
    matchedProductIds.length > 0
      ? supabase
          .from("products")
          .select("id, description, supplier_id, item_group_id, unit_cost, cost_currency, suppliers(id, name)")
          .in("id", matchedProductIds)
      : Promise.resolve({ data: [] as ProductJoinRow[] }),
    itemGroupIds.length > 0
      ? supabase
          .from("products")
          .select("id, description, supplier_id, item_group_id, unit_cost, cost_currency, suppliers(id, name)")
          .in("item_group_id", itemGroupIds)
      : Promise.resolve({ data: [] as ProductJoinRow[] }),
  ]);

  const matchedProductsById = new Map<string, MatchedProductInfo>();
  for (const p of (matchedProductsData as unknown as ProductJoinRow[]) ?? []) {
    matchedProductsById.set(p.id, {
      id: p.id,
      description: p.description,
      supplierName: p.suppliers?.name ?? null,
      unit_cost: p.unit_cost,
      cost_currency: p.cost_currency,
    });
  }

  const siblingByGroup = new Map<string, MatchedProductInfo>();
  for (const p of (siblingProductsData as unknown as ProductJoinRow[]) ?? []) {
    if (!p.item_group_id || siblingByGroup.has(p.item_group_id)) continue;
    siblingByGroup.set(p.item_group_id, {
      id: p.id,
      description: p.description,
      supplierName: p.suppliers?.name ?? null,
      unit_cost: p.unit_cost,
      cost_currency: p.cost_currency,
    });
  }
  const itemGroupsById = new Map(itemGroups.map((g) => [g.id, g]));

  const progress = computeUploadProgress(rows.map((r) => r.review_status));
  const bulkAcceptableCount = selectBulkAcceptableRowIds(rows).length;
  const acceptedCount = rows.filter((r) => r.review_status === "accepted" || r.review_status === "edited").length;
  const displayName = upload.suppliers?.name ? `${upload.suppliers.name} quote` : "Price file";

  return (
    <div className="max-w-6xl">
      <Link
        href={`/admin/price-files/${id}`}
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← Back to upload
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-veridan-ink">Review: {displayName}</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        {progress.total} line{progress.total === 1 ? "" : "s"} extracted — {progress.resolved} resolved
        {progress.remaining > 0 ? `, ${progress.remaining} remaining` : ", all resolved"}. Accepted rows update the
        Hardware Library; rejected rows are dropped. Nothing here computes a client price, margin, or FX conversion —
        that happens in the normal quote builder.
      </p>

      {!upload.supplier_id && (
        <div className="mt-6">
          <SupplierGateForm uploadId={id} suppliers={suppliers} />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mt-6">
          <InstructiveMessage
            title="No extracted lines yet"
            body="This upload has no extracted_prices rows. Run extraction from the upload page first."
          />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <AcceptAllButton uploadId={id} count={upload.supplier_id ? bulkAcceptableCount : 0} />
          </div>

          <section className="mt-4 overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-3 py-2">Raw source</th>
                  <th className="px-3 py-2">Proposal</th>
                  <th className="px-3 py-2">Match</th>
                  <th className="px-3 py-2 text-center">Confidence</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const matchKind = classifyMatchKind(row);
                  const matchedProduct = row.matched_product_id
                    ? (matchedProductsById.get(row.matched_product_id) ?? null)
                    : null;
                  const itemGroupMatch: ItemGroupMatchInfo | null =
                    matchKind === "item_group" && row.item_group_match_id
                      ? {
                          id: row.item_group_match_id,
                          family_name: itemGroupsById.get(row.item_group_match_id)?.family_name ?? "Unknown group",
                          sibling: siblingByGroup.get(row.item_group_match_id) ?? null,
                        }
                      : null;
                  return (
                    <ReviewRow
                      key={row.id}
                      uploadId={id}
                      row={row}
                      matchKind={matchKind}
                      matchedProduct={matchedProduct}
                      itemGroupMatch={itemGroupMatch}
                      itemGroups={itemGroups}
                      disabled={!upload.supplier_id}
                    />
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Seed a quote from this scan
        </h2>
        <SeedQuoteForm uploadId={id} projects={projects} companies={companies} acceptedCount={acceptedCount} />
      </section>
    </div>
  );
}

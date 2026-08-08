"use client";

import { useState, useTransition } from "react";
import type {
  ProductListItemCosts,
  ProductListItemView,
} from "./productView";
import { setProductActive } from "./actions";
import { ProductForm } from "./ProductForm";

export type { ProductPriceProvenance } from "./productView";

function formatCost(unitCost: number, currency: string) {
  return `${currency} ${unitCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * One row of the Hardware Library.
 *
 * THE COST SWITCH IS THE `costs` PROP ITSELF, not a boolean. `product` is a
 * cost-free DTO (see ./productView.ts) — it has no `unit_cost` field and cannot
 * be given one — so a staff viewer's RSC flight payload contains no supplier
 * cost, no cost currency, no supplier identity and no price-file provenance,
 * rather than containing them and declining to draw them. The server simply
 * omits `costs` for a staff session; there is nothing left to hide.
 *
 * The inline edit form lives behind the same gate because editing a product IS
 * cost entry. createProduct / updateProduct / setProductActive re-check the role
 * server-side regardless — this is presentation, not the boundary.
 */
export function ProductListItem({
  product,
  costs,
}: {
  product: ProductListItemView;
  costs?: ProductListItemCosts | null;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleActive() {
    setError(null);
    startTransition(async () => {
      const result = await setProductActive(product.id, !product.active);
      if (!result.ok) setError(result.error);
    });
  }

  if (editing && costs) {
    return (
      <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
        <ProductForm
          product={costs.row}
          suppliers={costs.suppliers}
          itemGroups={costs.itemGroups}
          productCategories={costs.productCategories}
          distinctFinishes={costs.distinctFinishes}
          onSaved={() => setEditing(false)}
        />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2 text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
        >
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-veridan-warm-gray-light py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-veridan-ink">{product.description}</p>
          {!product.active && (
            <span className="rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray">
              Archived
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          {product.genericCategory.replace("_", " ")}
          {product.manufacturer ? ` · ${product.manufacturer}` : ""}
          {product.productRef ? ` · ${product.productRef}` : ""}
          {product.catalogueRef ? ` · cat# ${product.catalogueRef}` : ""}
        </p>
        <p className="mt-1 text-xs text-veridan-ink/70">
          {costs
            ? `${formatCost(costs.unitCost, costs.costCurrency)} / ${product.unit}`
            : `per ${product.unit}`}
          {product.supplierName ? ` · ${product.supplierName}` : ""}
        </p>
        {(product.itemGroupLabel || product.finishCode || product.designSeries) && (
          <p className="mt-1 text-xs text-veridan-warm-gray">
            {product.itemGroupLabel ?? ""}
            {product.finishCode ? ` · supplied finish code ${product.finishCode}` : ""}
            {product.designSeries ? ` · ${product.designSeries}` : ""}
          </p>
        )}
        {costs?.priceProvenance && (
          <p className="mt-1 text-[11px] text-veridan-warm-gray">
            Last updated {formatDate(costs.priceProvenance.effectiveDate)} from{" "}
            {costs.priceProvenance.fileUrl ? (
              <a
                href={costs.priceProvenance.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
              >
                {costs.priceProvenance.fileName}
              </a>
            ) : (
              costs.priceProvenance.fileName
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {costs && product.itemGroupId && (
          <a
            href={`/admin/products/compare/${product.itemGroupId}`}
            className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            Compare offerings
          </a>
        )}
        {costs && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={toggleActive}
              disabled={pending}
              className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink disabled:opacity-50"
            >
              {pending ? "Saving…" : product.active ? "Archive" : "Restore"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

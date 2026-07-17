"use client";

import { useState, useTransition } from "react";
import type { ItemGroupRow, ProductWithSupplier, SupplierRow } from "@/lib/supabase/types";
import { setProductActive } from "./actions";
import { ProductForm } from "./ProductForm";

function formatCost(unitCost: number, currency: string) {
  return `${currency} ${unitCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Task 40 — read-only provenance for a product's most recent scanned price update. */
export interface ProductPriceProvenance {
  effectiveDate: string;
  fileName: string;
  fileUrl: string | null;
}

export function ProductListItem({
  product,
  suppliers,
  itemGroups,
  priceProvenance,
}: {
  product: ProductWithSupplier;
  suppliers: SupplierRow[];
  itemGroups: ItemGroupRow[];
  priceProvenance?: ProductPriceProvenance | null;
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

  if (editing) {
    return (
      <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
        <ProductForm product={product} suppliers={suppliers} itemGroups={itemGroups} onSaved={() => setEditing(false)} />
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
          {product.generic_category.replace("_", " ")}
          {product.manufacturer ? ` · ${product.manufacturer}` : ""}
          {product.product_ref ? ` · ${product.product_ref}` : ""}
          {product.catalogue_ref ? ` · cat# ${product.catalogue_ref}` : ""}
        </p>
        <p className="mt-1 text-xs text-veridan-ink/70">
          {formatCost(product.unit_cost, product.cost_currency)} / {product.unit}
          {product.suppliers ? ` · ${product.suppliers.name}` : ""}
        </p>
        {(product.item_groups || product.finish_code || product.design_series) && (
          <p className="mt-1 text-xs text-veridan-warm-gray">
            {product.item_groups
              ? `${product.item_groups.family_name}${product.item_groups.grade ? ` (${product.item_groups.grade})` : ""}`
              : ""}
            {product.finish_code ? ` · finish ${product.finish_code}` : ""}
            {product.design_series ? ` · ${product.design_series}` : ""}
          </p>
        )}
        {priceProvenance && (
          <p className="mt-1 text-[11px] text-veridan-warm-gray">
            Last updated {formatDate(priceProvenance.effectiveDate)} from{" "}
            {priceProvenance.fileUrl ? (
              <a
                href={priceProvenance.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
              >
                {priceProvenance.fileName}
              </a>
            ) : (
              priceProvenance.fileName
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
        {product.item_group_id && (
          <a
            href={`/admin/products/compare/${product.item_group_id}`}
            className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            Compare offerings
          </a>
        )}
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
      </div>
    </li>
  );
}

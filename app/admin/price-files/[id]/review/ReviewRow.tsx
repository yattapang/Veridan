"use client";

import { useActionState, useState, useTransition } from "react";
import {
  CURRENCY_CODES,
  PRODUCT_CATEGORIES,
  type CurrencyCode,
  type ExtractedPriceRow,
  type ItemGroupRow,
  type ProductCategory,
} from "@/lib/supabase/types";
import { confidencePercentLabel, confidenceTier, formatRawExtractedText, type ReviewMatchKind } from "@/lib/price-extraction/review";
import { acceptExtractedRow, rejectExtractedRow, type ReviewActionResult } from "./actions";

const initialResult: ReviewActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-2 py-1.5 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray";

const CATEGORY_LABELS: Record<string, string> = {
  locksets: "Locksets",
  closers: "Closers",
  hinges: "Hinges",
  exit_devices: "Exit devices",
  access_control: "Access control",
  ironmongery: "Ironmongery",
  signage: "Signage",
  frames: "Frames",
  other: "Other",
};

const CONFIDENCE_TIER_CLASS: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-red-50 text-red-600",
  unknown: "bg-veridan-warm-gray-pale text-veridan-warm-gray",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  confident: "bg-emerald-50 text-emerald-700",
  needs_review: "bg-amber-50 text-amber-700",
  accepted: "bg-blue-50 text-blue-600",
  edited: "bg-blue-50 text-blue-600",
  rejected: "bg-veridan-warm-gray-pale text-veridan-warm-gray line-through",
};

const STATUS_LABEL: Record<string, string> = {
  confident: "Confident",
  needs_review: "Needs review",
  accepted: "Accepted",
  edited: "Edited & accepted",
  rejected: "Rejected",
};

export interface MatchedProductInfo {
  id: string;
  description: string;
  supplierName: string | null;
  unit_cost: number;
  cost_currency: CurrencyCode;
}

export interface ItemGroupMatchInfo {
  id: string;
  family_name: string;
  sibling: MatchedProductInfo | null;
}

/** One extracted line in the review table: raw text, proposal, match, actions (Task 39). */
export function ReviewRow({
  uploadId,
  row,
  matchKind,
  matchedProduct,
  itemGroupMatch,
  itemGroups,
  crossSupplier,
  disabled,
}: {
  uploadId: string;
  row: ExtractedPriceRow;
  matchKind: ReviewMatchKind;
  matchedProduct: MatchedProductInfo | null;
  itemGroupMatch: ItemGroupMatchInfo | null;
  itemGroups: ItemGroupRow[];
  /** MAJOR-5: matched product belongs to a different supplier — accepting creates a new offering. */
  crossSupplier: boolean;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    acceptExtractedRow.bind(null, uploadId, row.id),
    initialResult
  );
  const [rejectPending, startRejectTransition] = useTransition();
  const [rejectError, setRejectError] = useState<string | null>(null);

  const resolved = row.review_status === "accepted" || row.review_status === "edited" || row.review_status === "rejected";
  // Cross-supplier existing-product matches also need a category: accepting
  // them creates THIS supplier's own offering (server-enforced, MAJOR-5)
  // rather than overwriting the other supplier's row.
  const needsCategory = matchKind !== "existing_product" || crossSupplier;
  const tier = confidenceTier(row.confidence_score);

  function handleReject() {
    setRejectError(null);
    startRejectTransition(async () => {
      const result = await rejectExtractedRow(uploadId, row.id);
      if (!result.ok) setRejectError(result.error);
    });
  }

  return (
    <tr className="border-b border-veridan-warm-gray-light align-top last:border-b-0">
      <td className="px-3 py-3 text-xs text-veridan-warm-gray max-w-[16rem] whitespace-pre-wrap">
        {formatRawExtractedText(row.raw_extracted_text)}
      </td>

      <td className="px-3 py-3">
        {editing && !resolved ? (
          <form id={`accept-form-${row.id}`} action={formAction} className="grid gap-2">
            <div>
              <label className={labelClass} htmlFor={`desc-${row.id}`}>
                Description
              </label>
              <input
                id={`desc-${row.id}`}
                name="description"
                type="text"
                defaultValue={row.proposed_description ?? ""}
                className={`${inputClass} mt-0.5`}
              />
            </div>
            <div className="flex gap-2">
              <div>
                <label className={labelClass} htmlFor={`cost-${row.id}`}>
                  Unit cost
                </label>
                <input
                  id={`cost-${row.id}`}
                  name="unit_cost"
                  type="number"
                  step="any"
                  min="0"
                  defaultValue={row.proposed_unit_cost ?? ""}
                  className={`${inputClass} mt-0.5 w-24`}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`currency-${row.id}`}>
                  Currency
                </label>
                <select
                  id={`currency-${row.id}`}
                  name="currency"
                  defaultValue={row.proposed_currency ?? "USD"}
                  className={`${inputClass} mt-0.5 w-20`}
                >
                  {CURRENCY_CODES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor={`qty-${row.id}`}>
                  Qty
                </label>
                <input
                  id={`qty-${row.id}`}
                  name="qty"
                  type="number"
                  step="any"
                  min="0"
                  defaultValue={row.proposed_qty ?? 1}
                  className={`${inputClass} mt-0.5 w-16`}
                />
              </div>
            </div>
            {needsCategory && (
              <div className="rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale p-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-veridan-warm-gray">
                  {crossSupplier
                    ? "New offering for this supplier (matched product belongs to a different supplier)"
                    : matchKind === "item_group"
                      ? "New offering for this item group"
                      : "New product — minimal details"}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <select
                    name="generic_category"
                    required
                    defaultValue={""}
                    className={`${inputClass} mt-0.5 max-w-[9rem]`}
                    aria-label="Category"
                  >
                    <option value="" disabled>
                      Category…
                    </option>
                    {PRODUCT_CATEGORIES.map((c: ProductCategory) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c] ?? c}
                      </option>
                    ))}
                  </select>
                  <select
                    name="item_group_id"
                    defaultValue={row.item_group_match_id ?? ""}
                    className={`${inputClass} mt-0.5 max-w-[10rem]`}
                    aria-label="Item group"
                  >
                    <option value="">— ungrouped —</option>
                    {itemGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.family_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-veridan-ink px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-veridan-paper disabled:opacity-50"
              >
                {pending ? "Saving…" : "Confirm accept"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-[10px] text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
              >
                Cancel
              </button>
            </div>
            {state.ok === false && (
              <p role="alert" className="text-xs text-red-600">
                {state.error}
              </p>
            )}
          </form>
        ) : (
          <div className="text-sm text-veridan-ink">
            <p>{row.proposed_description ?? "—"}</p>
            <p className="mt-1 text-xs text-veridan-warm-gray">
              {row.proposed_qty ?? 1} × {row.proposed_unit_cost ?? "—"} {row.proposed_currency ?? ""}
              {row.proposed_product_ref ? ` · Ref: ${row.proposed_product_ref}` : ""}
            </p>
          </div>
        )}
      </td>

      <td className="px-3 py-3 text-xs text-veridan-ink">
        {matchKind === "existing_product" && matchedProduct && (
          <div>
            <p className="font-medium">{matchedProduct.description}</p>
            <p className="text-veridan-warm-gray">
              {matchedProduct.supplierName ?? "Unknown supplier"} · current {matchedProduct.unit_cost}{" "}
              {matchedProduct.cost_currency}
            </p>
            {crossSupplier && (
              <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-700">
                Different supplier — accepting creates this supplier&apos;s own offering
              </p>
            )}
          </div>
        )}
        {matchKind === "item_group" && itemGroupMatch && (
          <div>
            <p className="font-medium">Item group: {itemGroupMatch.family_name}</p>
            {itemGroupMatch.sibling && (
              <p className="text-veridan-warm-gray">
                e.g. {itemGroupMatch.sibling.supplierName ?? "another supplier"} — {itemGroupMatch.sibling.unit_cost}{" "}
                {itemGroupMatch.sibling.cost_currency}
              </p>
            )}
            <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-700">New offering, different supplier</p>
          </div>
        )}
        {matchKind === "new_item" && <p className="text-veridan-warm-gray">New item — not in the library</p>}
      </td>

      <td className="px-3 py-3 text-center">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${CONFIDENCE_TIER_CLASS[tier]}`}>
          {confidencePercentLabel(row.confidence_score)}
        </span>
      </td>

      <td className="px-3 py-3 text-center">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE_CLASS[row.review_status]}`}>
          {STATUS_LABEL[row.review_status] ?? row.review_status}
        </span>
      </td>

      <td className="px-3 py-3 text-right">
        {!resolved && (
          <div className="flex flex-col items-end gap-2">
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={disabled}
                className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                Accept / edit
              </button>
            )}
            <button
              type="button"
              onClick={handleReject}
              disabled={rejectPending || disabled}
              className="text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink disabled:opacity-50"
            >
              {rejectPending ? "Rejecting…" : "Reject"}
            </button>
            {rejectError && (
              <p role="alert" className="text-xs text-red-600">
                {rejectError}
              </p>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

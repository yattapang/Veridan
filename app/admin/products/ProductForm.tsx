"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  CURRENCY_CODES,
  GRADE_VALUES,
  type ItemGroupRow,
  type ProductRow,
  type SupplierRow,
} from "@/lib/supabase/types";
import { buildTaxonomyOptions } from "@/lib/taxonomies/taxonomyAdmin";
import type { ManagedProductCategory } from "@/lib/products/categoriesLoader";
import type { DistinctFinishValues } from "@/lib/products/finishes";
import {
  createItemGroupInline,
  createProduct,
  updateProduct,
  type ProductFormResult,
} from "./actions";
import { createProductCategoryInline } from "./categories/actions";

const initialProductFormResult: ProductFormResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Shared create/edit form for a Hardware Library product (Task 11).
 * `product` present means edit mode (bound to updateProduct); absent
 * means the "new product" form (bound to createProduct).
 *
 * `productCategories` is the DB-first managed list (lib/products/
 * categoriesLoader.ts, falling back to the original 9 hardcoded values
 * when the table is unreachable/empty), read by the server component and
 * passed down here. Founder feedback 2026-08-07 ("Product Category should
 * also allow addition of New Categories in the drop down") — the Category
 * picker now offers an inline "+ New category" quick-create, exactly like
 * the item-group picker below it (Task 31). `distinctFinishes` is the set
 * of every distinct value already used for the three finish fields,
 * server-loaded (lib/products/finishes.ts), for the datalist type-aheads.
 */
export function ProductForm({
  product,
  suppliers,
  itemGroups,
  productCategories,
  distinctFinishes,
  onSaved,
}: {
  product?: ProductRow;
  suppliers: SupplierRow[];
  itemGroups: ItemGroupRow[];
  productCategories: ManagedProductCategory[];
  distinctFinishes: DistinctFinishValues;
  onSaved?: () => void;
}) {
  const action = product ? updateProduct.bind(null, product.id) : createProduct;
  const [state, formAction, pending] = useActionState<ProductFormResult, FormData>(
    action,
    initialProductFormResult
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const idSuffix = product?.id ?? "new";

  // Inline product-category quick-create (founder feedback 2026-08-07).
  // Same pattern as the item-group quick-create below: categories created
  // inline are tracked separately and merged with the server-provided
  // `productCategories` list at render time so a category created moments
  // ago still shows up before the next server round-trip refreshes it.
  const [locallyCreatedCategories, setLocallyCreatedCategories] = useState<ManagedProductCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(
    product?.generic_category ?? productCategories[0]?.name ?? ""
  );
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryPending, startCategoryTransition] = useTransition();

  const knownCategoryIds = new Set(productCategories.map((c) => c.id));
  const mergedCategories = [
    ...productCategories,
    ...locallyCreatedCategories.filter((c) => !knownCategoryIds.has(c.id)),
  ];
  const categoryOptions = buildTaxonomyOptions(mergedCategories, selectedCategory);

  function handleCreateCategory() {
    setCategoryError(null);
    startCategoryTransition(async () => {
      const result = await createProductCategoryInline(newCategoryLabel);
      if (!result.ok) {
        setCategoryError(result.error);
        return;
      }
      setLocallyCreatedCategories((prev) => [
        ...prev,
        { id: result.id, name: result.name, label: result.label, sort_order: 0 },
      ]);
      setSelectedCategory(result.name);
      setNewCategoryLabel("");
      setCreatingCategory(false);
    });
  }

  // Inline item-group quick-create (Task 31). Kept local to this form
  // instance rather than a separate component since it needs to write the
  // newly-created group's id straight into this form's select. Groups
  // created inline are tracked separately and merged with the server-
  // provided `itemGroups` list at render time (rather than syncing a copy
  // into state via an effect) so a group created moments ago still shows
  // up even before the next server round-trip refreshes `itemGroups`.
  const [locallyCreatedGroups, setLocallyCreatedGroups] = useState<ItemGroupRow[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(product?.item_group_id ?? "");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupGrade, setNewGroupGrade] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupPending, startGroupTransition] = useTransition();

  const knownIds = new Set(itemGroups.map((g) => g.id));
  const groups = [...itemGroups, ...locallyCreatedGroups.filter((g) => !knownIds.has(g.id))];

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      if (!product) formRef.current?.reset();
      onSaved?.();
    }
    wasPending.current = pending;
  }, [pending, state.ok, product, onSaved]);

  function handleCreateGroup() {
    setGroupError(null);
    startGroupTransition(async () => {
      const result = await createItemGroupInline(newGroupName, newGroupGrade);
      if (!result.ok) {
        setGroupError(result.error);
        return;
      }
      setLocallyCreatedGroups((prev) => [
        ...prev,
        {
          id: result.id,
          family_name: newGroupName.trim(),
          grade: (newGroupGrade || null) as ItemGroupRow["grade"],
          notes: null,
          created_at: "",
          updated_at: "",
        },
      ]);
      setSelectedGroupId(result.id);
      setNewGroupName("");
      setNewGroupGrade("");
      setCreatingGroup(false);
    });
  }

  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`description-${idSuffix}`}>
          Description
        </label>
        <input
          id={`description-${idSuffix}`}
          type="text"
          name="description"
          required
          defaultValue={product?.description}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className={labelClass} htmlFor={`category-${idSuffix}`}>
            Category
          </label>
          <Link
            href="/admin/products/categories"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium text-veridan-accent-text underline underline-offset-2 hover:text-veridan-ink"
          >
            Manage categories
          </Link>
        </div>
        <select
          id={`category-${idSuffix}`}
          name="generic_category"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className={`${inputClass} mt-1`}
        >
          {categoryOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {!creatingCategory ? (
          <button
            type="button"
            onClick={() => setCreatingCategory(true)}
            className="mt-1 text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            + New category
          </button>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale p-2">
            <input
              type="text"
              value={newCategoryLabel}
              onChange={(e) => setNewCategoryLabel(e.target.value)}
              placeholder="Category name"
              className={`${inputClass} max-w-[12rem]`}
            />
            <button
              type="button"
              onClick={handleCreateCategory}
              disabled={categoryPending || !newCategoryLabel.trim()}
              className="rounded-md bg-veridan-ink px-3 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper disabled:opacity-50"
            >
              {categoryPending ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatingCategory(false);
                setCategoryError(null);
              }}
              className="text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
            >
              Cancel
            </button>
            {categoryError && (
              <p role="alert" className="w-full text-xs text-red-600">
                {categoryError}
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <label className={labelClass} htmlFor={`manufacturer-${idSuffix}`}>
          Manufacturer
        </label>
        <input
          id={`manufacturer-${idSuffix}`}
          type="text"
          name="manufacturer"
          placeholder="Assa Abloy, Allegion, LCN…"
          defaultValue={product?.manufacturer ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`catalogue-${idSuffix}`}>
          Catalogue ref
        </label>
        <input
          id={`catalogue-${idSuffix}`}
          type="text"
          name="catalogue_ref"
          defaultValue={product?.catalogue_ref ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`product-ref-${idSuffix}`}>
          Product / SKU ref
        </label>
        <input
          id={`product-ref-${idSuffix}`}
          type="text"
          name="product_ref"
          defaultValue={product?.product_ref ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      {/*
        Finish group (founder feedback 2026-08-07: "the specified finish,
        and the finish code are not side by side or not intuitive" +
        "the finish should allow drop down options that when typed data
        is entered if it already exists then it is filtered"). All three
        finish-related fields — specified_finish (what the architect's
        schedule calls for), supplied_finish (what will actually ship),
        finish_code (the short BHMA code) — are grouped together, side by
        side, in this labelled fieldset, in that order. Each is a plain
        text input with a native HTML <datalist> type-ahead
        (list={id}-list) populated from every DISTINCT value already used
        for that column across the Hardware Library (server-loaded by
        app/admin/products/page.tsx via lib/products/finishes.ts's
        collectDistinctFinishValues) — typing filters to existing values
        (native browser behavior) while still allowing any new value.
      */}
      <fieldset className="sm:col-span-2 rounded-md border border-veridan-warm-gray-light p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Finish
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor={`specified-finish-${idSuffix}`}>
              Specified finish
            </label>
            <input
              id={`specified-finish-${idSuffix}`}
              type="text"
              name="specified_finish"
              list={`specified-finish-list-${idSuffix}`}
              placeholder="US32D, Satin Chrome…"
              defaultValue={product?.specified_finish ?? ""}
              className={`${inputClass} mt-1`}
            />
            <datalist id={`specified-finish-list-${idSuffix}`}>
              {distinctFinishes.specifiedFinishes.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-veridan-warm-gray">What the architect&apos;s schedule calls for.</p>
          </div>

          <div>
            <label className={labelClass} htmlFor={`supplied-finish-${idSuffix}`}>
              Supplied finish
            </label>
            <input
              id={`supplied-finish-${idSuffix}`}
              type="text"
              name="supplied_finish"
              list={`supplied-finish-list-${idSuffix}`}
              placeholder="Defaults to Satin Stainless Steel / US32D if left blank"
              defaultValue={product?.supplied_finish ?? ""}
              className={`${inputClass} mt-1`}
            />
            <datalist id={`supplied-finish-list-${idSuffix}`}>
              {distinctFinishes.suppliedFinishes.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-veridan-warm-gray">What will actually ship.</p>
          </div>

          <div>
            <label className={labelClass} htmlFor={`finish-code-${idSuffix}`}>
              Finish code
            </label>
            <input
              id={`finish-code-${idSuffix}`}
              type="text"
              name="finish_code"
              list={`finish-code-list-${idSuffix}`}
              placeholder="US32D, US26D…"
              defaultValue={product?.finish_code ?? ""}
              className={`${inputClass} mt-1`}
            />
            <datalist id={`finish-code-list-${idSuffix}`}>
              {distinctFinishes.finishCodes.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-veridan-warm-gray">Short BHMA code, e.g. US32D.</p>
          </div>
        </div>
      </fieldset>

      <div>
        <label className={labelClass} htmlFor={`supplier-${idSuffix}`}>
          Default supplier
        </label>
        <select
          id={`supplier-${idSuffix}`}
          name="supplier_id"
          defaultValue={product?.supplier_id ?? ""}
          className={`${inputClass} mt-1`}
        >
          <option value="">— none —</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor={`item-group-${idSuffix}`}>
          Item group
        </label>
        <select
          id={`item-group-${idSuffix}`}
          name="item_group_id"
          value={selectedGroupId}
          onChange={(e) => setSelectedGroupId(e.target.value)}
          className={`${inputClass} mt-1`}
        >
          <option value="">— ungrouped —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.family_name}
              {g.grade ? ` (${g.grade})` : ""}
            </option>
          ))}
        </select>
        {!creatingGroup ? (
          <button
            type="button"
            onClick={() => setCreatingGroup(true)}
            className="mt-1 text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            + New item group
          </button>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale p-2">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Family name"
              className={`${inputClass} max-w-[12rem]`}
            />
            <select
              value={newGroupGrade}
              onChange={(e) => setNewGroupGrade(e.target.value)}
              className={`${inputClass} max-w-[8rem]`}
              aria-label="New group grade"
            >
              <option value="">No grade</option>
              {GRADE_VALUES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreateGroup}
              disabled={groupPending || !newGroupName.trim()}
              className="rounded-md bg-veridan-ink px-3 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper disabled:opacity-50"
            >
              {groupPending ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatingGroup(false);
                setGroupError(null);
              }}
              className="text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
            >
              Cancel
            </button>
            {groupError && (
              <p role="alert" className="w-full text-xs text-red-600">
                {groupError}
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <label className={labelClass} htmlFor={`design-series-${idSuffix}`}>
          Design series
        </label>
        <input
          id={`design-series-${idSuffix}`}
          type="text"
          name="design_series"
          placeholder="Athens, Rhodes… (locksets only, optional)"
          defaultValue={product?.design_series ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`unit-${idSuffix}`}>
          Unit
        </label>
        <input
          id={`unit-${idSuffix}`}
          type="text"
          name="unit"
          required
          placeholder="each, set, pair…"
          defaultValue={product?.unit ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`unit-cost-${idSuffix}`}>
          Unit cost
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id={`unit-cost-${idSuffix}`}
            type="number"
            name="unit_cost"
            step="any"
            min="0"
            required
            defaultValue={product?.unit_cost}
            className={inputClass}
          />
          <select
            name="cost_currency"
            defaultValue={product?.cost_currency ?? "USD"}
            className={`${inputClass} max-w-[6.5rem]`}
            aria-label="Cost currency"
          >
            {CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : product ? "Save changes" : "Add product"}
        </button>
        {state.ok === false && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

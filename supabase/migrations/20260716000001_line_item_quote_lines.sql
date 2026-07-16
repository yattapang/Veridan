-- ============================================================================
-- Veridan Limited — Task 17 (line_item quote mode) additive migration
--
-- §1.9's quote_line_items table was designed around door_register mode, where
-- every line always comes from a Hardware Set line item and therefore always
-- has a product_id. Line-item mode (retrofit/simple jobs, §6.2) needs two
-- more things the original table doesn't provide:
--
-- 1. quote_line_items.product_id — relax NOT NULL. A line-item-mode quote
--    line can be either (a) picked from the Hardware Library (product_id
--    set, same as door_register) or (b) a free-text ad-hoc line with no
--    library entry (product_id null, description_override carries the
--    text). The landed-cost engine already treats QuoteLineInput.productId
--    as optional/nullable (lib/landed-cost/types.ts) — it was never used in
--    the math, only carried through for display — so this is a pure schema
--    relaxation, no engine change needed.
--
-- 2. quote_line_items.supplier_id — new column. door_register mode never
--    needed this on the quote line itself because its origin pool is
--    assigned once at quote-materialization time from the hardware set
--    line's supplier_id (hardware_set_line_items.supplier_id) and never
--    revisited. line_item mode has no hardware set to read a supplier from
--    — lines are added directly to the draft quote one at a time — so each
--    line now carries its own supplier_id (defaulted from the product's
--    default supplier when picked from the library; required via an
--    explicit select for an ad-hoc line). This is what
--    lib/quotes/mapping.ts's buildOriginGroups/supplierOriginLabelMap (the
--    same origin-grouping logic Task 16 used for door_register) regroups
--    lines against on every add/edit/remove (lib/quotes/persist.ts
--    regroupLineItemOrigins) so origin pools stay in sync with whichever
--    suppliers are actually on the draft.
--
-- A check constraint keeps every line describable: a line with no product
-- must at least carry description_override (already an existing nullable
-- column, §1.9 — "per-quote override, does not touch products table" — is
-- simply what an ad-hoc line's ONLY description is, rather than an override
-- of a product's description).
-- ============================================================================

alter table public.quote_line_items
  alter column product_id drop not null;

alter table public.quote_line_items
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

comment on column public.quote_line_items.supplier_id is
  'Supplier this line is costed against (Task 17, line_item mode). Drives origin-pool regrouping via lib/quotes/mapping.ts buildOriginGroups. Always populated for line_item-mode lines (library pick defaults it from the product; ad-hoc lines require an explicit select). Null for door_register-mode lines, whose origin is fixed at quote-materialization time from the hardware set line''s supplier.';

alter table public.quote_line_items
  add constraint chk_qli_product_or_description
    check (product_id is not null or description_override is not null);

create index if not exists idx_qli_supplier_id on public.quote_line_items (supplier_id);

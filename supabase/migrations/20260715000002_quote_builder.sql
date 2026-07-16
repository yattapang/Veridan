-- ============================================================================
-- Veridan Limited — Task 16 (Door Register quote builder) additive migration
--
-- Two schema adjustments the quote builder genuinely needs that the original
-- §1 schema (20260713000001_schema.sql) does not already provide:
--
-- 1. quote_line_items.margin_pct_override — the build brief and §7.1 item 8
--    call for an OPTIONAL per-line margin override on top of the quote-level
--    tier. The landed-cost engine (lib/landed-cost/types.ts:QuoteLineInput
--    .marginPctOverride) already supports it; there was no column to persist
--    it. Nullable: null means "use the quote's selected tier".
--
-- 2. quote_origins.ocean_freight_usd — relax NOT NULL + drop the DEFAULT 0 so
--    the column can hold NULL. The engine (OriginCostInput.oceanFreightUsd)
--    treats null as "ocean freight not yet itemized" → apply the $1,250
--    combined freight+insurance planning FALLBACK (§7.1 item 2), which is a
--    distinct state from an explicit itemized $0. With the old `not null
--    default 0`, "not yet entered" and "itemized as $0" were indistinguishable
--    and every new origin would silently suppress the fallback. Existing rows
--    (there are none in Phase 1 yet) keep their 0 value; new origins created
--    by the builder store NULL until a real freight quote is entered.
-- ============================================================================

alter table public.quote_line_items
  add column if not exists margin_pct_override numeric(5,2);

comment on column public.quote_line_items.margin_pct_override is
  'Optional per-line margin % override (§7.1 item 8). NULL = use the quote''s selected margin tier. Maps to QuoteLineInput.marginPctOverride in the landed-cost engine.';

alter table public.quote_origins
  alter column ocean_freight_usd drop default;

alter table public.quote_origins
  alter column ocean_freight_usd drop not null;

comment on column public.quote_origins.ocean_freight_usd is
  'Itemized ocean freight, USD. NULL = not yet entered → the $1,250 combined freight+insurance planning fallback applies (§7.1 item 2), which supersedes both itemized freight and the 1.5% marine-insurance formula. An explicit 0 means "itemized as zero", NOT the fallback.';

-- ============================================================================
-- Additive migration — Task 14 (Hardware Set builder).
--
-- The build plan brief for Task 14 calls for "per-line notes" on hardware
-- set line items, but §1.4 of Veridan_Build_Plan_v1.md (and the committed
-- 20260713000001_schema.sql) does not include a notes column on
-- hardware_set_line_items. Per the instruction to add a new migration
-- rather than edit a committed one, this adds a single nullable text
-- column. Nullable + no default-data impact, so it's safe to run against
-- an already-seeded database.
-- ============================================================================

alter table public.hardware_set_line_items
  add column if not exists notes text;

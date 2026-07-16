-- ============================================================================
-- Veridan Limited — Task 19 (quote workflow states) additive migration
--
-- §1.7's quotes table already carries sent_at/viewed_at/accepted_at/
-- declined_at and a status CHECK constraint covering the full pipeline
-- ('draft' -> 'approved' -> 'sent' -> 'viewed' [Phase 2] -> 'accepted' |
-- 'declined' -> 'expired'), so no enum change is needed here. Three columns
-- are missing for the approve/send steps this task implements:
--
-- 1. approved_by  — which founder approved the quote (either founder may,
--    per PRD §6.4 "Approve (in-app review/edit by either founder)").
-- 2. approved_at  — when it was approved; drives the workflow status
--    timeline strip on the quote detail page.
-- 3. sent_to      — the recipient email address the quote was actually
--    emailed to (the founder picks/enters this at send time, prefilled from
--    the company's first contact per the Task 19 brief) — kept distinct from
--    any contact record since it's a record of what was actually sent, not
--    a live pointer to a contact that could later be edited/deleted.
-- ============================================================================

alter table public.quotes
  add column approved_by uuid references public.users (id) on delete set null,
  add column approved_at timestamptz,
  add column sent_to text;

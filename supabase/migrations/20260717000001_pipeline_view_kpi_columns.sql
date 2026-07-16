-- ============================================================================
-- Veridan Limited — Task 20 (pipeline view) additive migration
--
-- `pipeline_view` (§1.13, created in 20260713000001_schema.sql) is a VIEW
-- over enquiries/projects/quotes, not a table — the build plan is explicit
-- that pipeline stage must not be dual-sourced. This migration
-- CREATE OR REPLACE's the same view (same OID, so grants from
-- 20260713000002_rls.sql still apply) to fix two gaps found while building
-- the /admin/pipeline + /admin dashboard KPI tiles:
--
-- 1. `q.status = 'expired'` had no branch in the original CASE, so an
--    expired quote fell all the way through to the `e.status` checks and
--    usually landed on 'Unknown' (its enquiry is normally 'converted' by
--    that point, which also wasn't handled — see #2). Expired quotes were
--    sent and timed out, so they belong in the 'Sent' bucket alongside
--    approved/sent/viewed, same as the PRD §8 stage list treats "Sent" as
--    the pre-resolution bucket.
-- 2. `e.status = 'converted'` (set once an enquiry becomes a project, see
--    §1.12) had no branch either, so a converted enquiry with a project but
--    no quote drafted yet also fell to 'Unknown'. That gap is real and
--    common (every enquiry passes through it between conversion and the
--    first quote draft) — mapped to 'Technical Review', the last completed
--    PRD stage before a quote exists.
--
-- Also widens the selected columns so the KPI computation (lib/kpis.ts) and
-- the /admin/pipeline list don't need a second round-trip per row for the
-- timestamps/totals already sitting on `quotes`.
-- ============================================================================

-- NOTE: CREATE OR REPLACE cannot reorder/rename view columns (fails with
-- "cannot change name of view column"), so the view is dropped and
-- recreated. Views run with owner privileges over RLS'd tables; no grants
-- are lost that the recreate below doesn't restore.
drop view if exists public.pipeline_view;

create view public.pipeline_view as
select
  e.id as enquiry_id,
  p.id as project_id,
  q.id as quote_id,
  e.company_name,
  e.contact_name,
  e.pathway,
  e.status as enquiry_status,
  e.created_at as enquiry_created_at,
  q.quote_ref,
  q.status as quote_status,
  q.sent_at,
  q.accepted_at,
  q.declined_at,
  q.total_client_jmd,
  q.total_client_usd,
  q.total_landed_usd,
  p.status as project_status,
  case
    when p.status = 'closed' then 'Fulfilled'
    when q.status = 'accepted' then 'Accepted'
    when q.status = 'declined' then 'Declined'
    when q.status in ('approved','sent','viewed','expired') then 'Sent'
    when q.status = 'draft' then 'Quote Drafted'
    when e.status in ('reviewing','converted') then 'Technical Review'
    when e.status = 'new' then 'Enquiry'
    else 'Unknown'
  end as stage
from public.enquiries e
left join public.projects p on p.enquiry_id = e.id
left join public.quotes q on q.project_id = p.id;

-- Founder tooling only: anonymous role has no business reading the pipeline.
revoke all on public.pipeline_view from anon;

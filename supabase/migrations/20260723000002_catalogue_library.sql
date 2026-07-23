-- ============================================================================
-- Veridan Limited — Phase 3C: catalogue/spec library
-- Source: Veridan_Phase3_Plan_v1.md §3 (3.1-3.5). Lead-added scope (not a
-- named PRD §9.4 deliverable) extending the marketing site's lead-generation
-- surface for architects with browsable supplier catalogue/spec-sheet PDFs.
--
-- *** THE §3.3 GUARDRAIL — READ BEFORE TOUCHING THIS FILE ***
-- Supplier catalogues carry republishing-rights risk: does Veridan actually
-- hold the right to publish each supplier's catalogue/spec-sheet publicly?
-- That is a licensing question only the founders can answer, per supplier —
-- NOT a build question. The build's job is to make the DEFAULT safe and the
-- TOGGLE deliberate:
--   1. Every row defaults visibility = 'internal' on insert — a SCHEMA-LEVEL
--      default (see the column definition below), not just a UI default, so
--      it cannot be bypassed by a form bug or a direct insert.
--   2. The `catalogue-files` Storage bucket stays PRIVATE regardless of a
--      row's visibility flag. There is no separate "public catalogue
--      bucket" and no public bucket URL for any file, ever — every document,
--      public or internal, lands in the same private bucket.
--   3. Public access to the actual file bytes happens ONLY through the gated
--      route app/api/catalogue/[id]/download (+ /thumbnail), which re-reads
--      `visibility` LIVE via the service-role client (lib/supabase/admin.ts)
--      on every single request and issues a short-lived (60s) signed Storage
--      URL only if visibility = 'public' at that exact moment — never a
--      cached decision, never derived from a row selected earlier in the
--      request. See lib/catalogue/gatedDownload.ts.
--   4. The anon role gets NO Storage grant on `catalogue-files` whatsoever
--      (no policy for the anon role is created below) — only the
--      service-role client used by the gated route can ever read an object
--      in this bucket. This makes it safe for the anon-selectable
--      `catalogue_documents` row to include `file_storage_path` /
--      `thumbnail_storage_path` as plain columns (§3.3): the path string
--      alone grants no access without a Storage grant or a signed URL.
-- ============================================================================

create table public.catalogue_documents (
  id                      uuid primary key default gen_random_uuid(),
  brand                   text not null, -- free text for now (Plan §8 Q7 — same vocabulary caveat as item_groups.family_name)
  category                text,          -- free text; recommend reusing product_categories keys where natural (Plan §3.2)
  title                   text not null,
  description             text,
  file_storage_path       text not null, -- path within the PRIVATE catalogue-files bucket
  original_filename       text,
  file_size_bytes         integer,
  thumbnail_storage_path  text,          -- optional cover-image path, ALSO in the private bucket — gated the same way as the document itself (see lib/catalogue/gatedDownload.ts), never a separate public bucket
  supplier_id             uuid references public.suppliers (id) on delete set null, -- optional cross-link to the Suppliers table
  -- *** THE LOAD-BEARING DEFAULT — see guardrail note above. Every insert
  -- path (form bug, script, manual insert) lands on 'internal' unless a
  -- founder explicitly overrides it. ***
  visibility              text not null default 'internal' check (visibility in ('internal', 'public')),
  published_at            timestamptz,   -- set only when a founder explicitly flips visibility to 'public' (see app/admin/catalogue/actions.ts)
  uploaded_by             uuid references public.users (id) on delete set null,
  uploaded_at             timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger set_updated_at before update on public.catalogue_documents
  for each row execute function public.set_updated_at();

-- Filter-bar / public-browse-query indexes (Plan §3.2).
create index idx_catalogue_documents_visibility_category on public.catalogue_documents (visibility, category);
create index idx_catalogue_documents_brand on public.catalogue_documents (brand);
create index idx_catalogue_documents_supplier_id on public.catalogue_documents (supplier_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.catalogue_documents enable row level security;

create policy catalogue_documents_founder_all on public.catalogue_documents
  for all to authenticated using (true) with check (true);

-- ============================================================================
-- *** THIRD ANON-SELECT RLS POLICY IN THIS APP, SECOND ROW-SCOPED ONE ***
--
-- site_content_anon_select (20260722000001_site_content.sql) was the first
-- anon-SELECT policy and is deliberately blanket (every row is public
-- marketing copy by construction). articles_anon_select_published
-- (20260723000001_articles_workspace.sql) was the first ROW-SCOPED one,
-- scoped to status = 'published'. This is the same shape again, scoped to
-- visibility = 'public' — flagged prominently per the plan and a named item
-- in the Phase 3C Layer 2 independent-review checklist. Verify on any future
-- edit to this migration that the USING clause stays EXACTLY
-- `visibility = 'public'` — an internal document's row must never be
-- selectable by anon under any query shape (join, RPC, etc.).
--
-- This policy governs the METADATA row only (title/brand/category/
-- description/file_storage_path/thumbnail_storage_path as plain columns) —
-- it does NOT itself grant file access. The actual bytes are reachable only
-- through the gated route (guardrail note above), which re-checks visibility
-- live via the service-role client regardless of what this policy already
-- filtered. Defense in depth: RLS row-scoping AND a live re-check at the
-- Storage-signing boundary, not either alone.
-- ============================================================================
create policy catalogue_documents_anon_select_public on public.catalogue_documents
  for select to anon
  using (visibility = 'public');

grant select on public.catalogue_documents to anon;

-- ----------------------------------------------------------------------------
-- Storage bucket — PRIVATE, single bucket for every document regardless of
-- visibility (Plan §3.2: "there is deliberately no separate 'public
-- catalogue bucket'").
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('catalogue-files', 'catalogue-files', false)
on conflict (id) do nothing;

-- Founders only, full access — same shape as price_files_founder_all
-- (20260713000002_rls.sql).
create policy catalogue_files_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'catalogue-files')
  with check (bucket_id = 'catalogue-files');

-- Deliberately NO anon policy of any kind on this bucket. RLS on
-- storage.objects default-denies anon once a bucket has any policy at all on
-- it for other roles, so anon has zero read/write here — the ONLY path to a
-- public document's bytes is the gated route's service-role signed URL.

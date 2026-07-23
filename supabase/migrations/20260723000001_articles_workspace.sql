-- ============================================================================
-- Veridan Limited — Phase 3B: article workspace (AI-assisted drafting,
-- editor, public articles)
-- Source: Veridan_Phase3_Plan_v1.md §2 (2.1-2.6). Founder decisions
-- 2026-07-23 (resolve §8 open questions 3 & 4):
--   - categories = a curated HYBRID set, education-led (see
--     lib/articles/categories.ts) — articles.category stays free text, the
--     editor presents the curated list as suggestions plus a custom entry.
--   - AI disclosure = NO public label. ai_assisted is logged internally
--     (provenance) only — never rendered on the public article page.
--
-- Extends the existing `articles` stub (20260713000001_schema.sql, already
-- live: id/title/slug/body/status/author/published_at/
-- linkedin_cross_posted/created_at/updated_at, articles_founder_all RLS
-- already applied) via an additive ALTER TABLE — same discipline as
-- Phase 2A's `products` ALTER (20260717000002_item_groups_and_product_
-- variants.sql). Adds article_ai_draft_log, a new provenance/audit table
-- logging EVERY AI-draft call whether or not the founder accepts it.
-- ============================================================================

alter table public.articles
  add column excerpt          text,
  add column category         text,
  add column hero_image_path  text,
  add column seo_title        text,
  add column seo_description  text,
  add column ai_assisted      boolean not null default false,
  add column source_notes     text;

comment on column public.articles.excerpt is
  'Shown in the public article list and used as the SEO description fallback
   when seo_description is null.';

comment on column public.articles.category is
  'Free text, nullable — NOT an enum/check constraint. Founder decision
   2026-07-23: a curated, education-led HYBRID set is presented as
   SUGGESTIONS in the editor UI (datalist over lib/articles/categories.ts),
   but a founder may type any custom value. Kept free text so the suggested
   list can evolve without a migration. The public article list may group or
   filter by this value.';

comment on column public.articles.hero_image_path is
  'Storage path within the PUBLIC article-hero-images bucket (see below).
   Nullable — an article need not have a hero image.';

comment on column public.articles.seo_title is
  'Falls back to title when null (see lib/articles public loader).';

comment on column public.articles.seo_description is
  'Falls back to excerpt when null (see lib/articles public loader).';

comment on column public.articles.ai_assisted is
  'Provenance flag only, set when a founder has ever Accepted an AI-drafted
   proposal into this article''s body. Founder decision 2026-07-23: this
   flag is NEVER rendered on the public article page — no "written with AI"
   or similar disclosure anywhere in this build. It exists purely for
   internal audit, alongside the full call-by-call trail in
   article_ai_draft_log below.';

comment on column public.articles.source_notes is
  'The founder''s drafting notes / spec-sheet reference kept for audit —
   mirrors extracted_prices.raw_extracted_text''s provenance discipline
   (Phase 2B).';

-- ----------------------------------------------------------------------------
-- article_ai_draft_log — audit trail for EVERY AI-draft call (Plan §2.2),
-- whether or not the founder accepts the output. Non-repudiation: "was this
-- article AI-drafted, and from what input."
--
-- GUARDRAIL (Plan §2.3, load-bearing — Layer 2 review checks this): this is
-- the ONLY table the AI-draft endpoint (app/api/articles/[id]/ai-draft,
-- lib/articles/aiDraft.ts) ever writes to. It never writes articles.body and
-- never flips articles.status — the founder must explicitly Accept a
-- proposal in the editor (a client-side textarea insert) and then Save.
-- ----------------------------------------------------------------------------
create table public.article_ai_draft_log (
  id                uuid primary key default gen_random_uuid(),
  article_id        uuid not null references public.articles (id) on delete cascade,
  instruction       text not null check (instruction in ('draft','expand','rewrite')),
  notes             text,
  source_file_path  text,
  model             text,
  response_text     text,
  created_by        uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now()
);
create index idx_article_ai_draft_log_article_id on public.article_ai_draft_log (article_id);

alter table public.article_ai_draft_log enable row level security;

create policy article_ai_draft_log_founder_all on public.article_ai_draft_log
  for all to authenticated using (true) with check (true);
-- No anon policy of ANY kind on this table, ever — it is an internal
-- provenance log (draft notes, raw model output), never public. RLS
-- default-denies anon entirely once enabled, with no anon policy present.

grant select, insert, update, delete on public.article_ai_draft_log to authenticated;

-- ============================================================================
-- *** SECOND ANON-SELECT RLS POLICY IN THIS APP, FIRST ROW-SCOPED ONE ***
--
-- site_content_anon_select (20260722000001_site_content.sql) was the first
-- anon-SELECT policy in this app and is deliberately blanket (`using (true)`)
-- because every site_content row is public marketing copy by construction.
-- articles is different: a row can be 'draft', 'review', or 'published', and
-- only 'published' rows may ever be visible to an unauthenticated request.
-- This is the first ROW-SCOPED anon-select policy in the schema — flagged
-- prominently per the plan, and it is a named item in the Phase 3B Layer 2
-- independent-review checklist. Verify on any future edit to this migration
-- that the USING clause stays EXACTLY `status = 'published'` — a draft or
-- review-status article must never be selectable by anon under any query
-- shape (join, RPC, etc.).
-- ============================================================================
create policy articles_anon_select_published on public.articles
  for select to anon
  using (status = 'published');

grant select on public.articles to anon;

-- ============================================================================
-- Storage buckets.
--
--   article-source-uploads — private (public: false). Optional spec-sheet /
--                             reference documents a founder feeds to the AI
--                             drafter as a document content block (mirrors
--                             the price-files upload pattern). Founder-only,
--                             same policy shape as the existing `price-files`
--                             bucket (20260713000002_rls.sql).
--   article-hero-images    — PUBLIC (public: true). The ONE deliberate public
--                             bucket in this app to date (every other bucket
--                             — enquiry-uploads, quote-pdfs, price-files,
--                             invoice-pdfs, article-source-uploads — is
--                             private). Scoped narrowly to article hero
--                             images: these must render on the public
--                             marketing site with no auth and no gated-
--                             download indirection, unlike a licensable
--                             supplier catalogue PDF (Phase 3C's
--                             catalogue-files bucket, which stays private and
--                             gated behind a live visibility re-check). A
--                             hero image is a decorative asset a founder
--                             chose to publish alongside a published article
--                             — there is no comparable "was this actually
--                             licensed for public redistribution" question
--                             the way there is for a supplier's own document.
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('article-source-uploads', 'article-source-uploads', false),
  ('article-hero-images', 'article-hero-images', true)
on conflict (id) do nothing;

-- article-source-uploads: founders only, full access (mirrors price-files).
create policy article_source_uploads_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'article-source-uploads')
  with check (bucket_id = 'article-source-uploads');

-- article-hero-images: founders manage (upload/replace/delete).
create policy article_hero_images_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'article-hero-images')
  with check (bucket_id = 'article-hero-images');

-- article-hero-images: anon SELECT only, scoped to this bucket alone — the
-- one deliberate public-read exception in this app. No anon INSERT/UPDATE/
-- DELETE on any bucket anywhere in this schema.
create policy article_hero_images_anon_select on storage.objects
  for select to anon
  using (bucket_id = 'article-hero-images');

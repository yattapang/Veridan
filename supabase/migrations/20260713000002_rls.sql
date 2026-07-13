-- ============================================================================
-- Veridan Limited — RLS policies
-- Source: Veridan_Build_Plan_v1.md §1 header note + Task 4.
--
-- Model (Phase 1, §10): exactly two authenticated staff users (Ken, Kaylia),
-- both founders, both with full CRUD on everything — "both can do everything,
-- roles are defaults not walls." There is no public sign-up flow in this app,
-- so any `authenticated` Supabase Auth session IS a founder session. Policies
-- below key off `auth.role() = 'authenticated'` for that reason, which is
-- simpler and just as safe as a per-row founder lookup given that constraint.
-- If a non-founder authenticated role is ever introduced (Phase 3 client
-- portal, §12.1), tighten these policies to check public.users.role at that
-- time — do not do it preemptively since it is out of scope now.
--
-- Anonymous (`anon`) role: INSERT-only on `enquiries`, column-restricted via
-- a WITH CHECK clause (cheaper and simpler than a security-definer RPC for
-- the shape of this table — see build plan Task 4 "keep it simple and safe").
-- No anonymous SELECT/UPDATE/DELETE anywhere.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enable RLS on every table (Phase 1 + Phase 2/3, since the plan calls for
-- specced-but-empty Phase 2/3 tables to already be safe by default).
-- ----------------------------------------------------------------------------
alter table public.users                    enable row level security;
alter table public.suppliers                enable row level security;
alter table public.companies                enable row level security;
alter table public.contacts                 enable row level security;
alter table public.products                 enable row level security;
alter table public.enquiries                enable row level security;
alter table public.projects                 enable row level security;
alter table public.hardware_sets            enable row level security;
alter table public.hardware_set_line_items  enable row level security;
alter table public.doors                    enable row level security;
alter table public.quotes                   enable row level security;
alter table public.quote_origins            enable row level security;
alter table public.quote_line_items         enable row level security;
alter table public.business_parameters      enable row level security;
alter table public.parameter_audit_log      enable row level security;
alter table public.override_log             enable row level security;
alter table public.invoices                 enable row level security;
alter table public.payments                 enable row level security;
alter table public.price_file_uploads       enable row level security;
alter table public.extracted_prices         enable row level security;
alter table public.orders                   enable row level security;
alter table public.actual_costs             enable row level security;
alter table public.articles                 enable row level security;

-- ----------------------------------------------------------------------------
-- Founder full-CRUD policy, one per table (Postgres has no single
-- cross-table policy syntax). Named consistently as `<table>_founder_all`.
-- ----------------------------------------------------------------------------
create policy users_founder_all on public.users
  for all to authenticated using (true) with check (true);

create policy suppliers_founder_all on public.suppliers
  for all to authenticated using (true) with check (true);

create policy companies_founder_all on public.companies
  for all to authenticated using (true) with check (true);

create policy contacts_founder_all on public.contacts
  for all to authenticated using (true) with check (true);

create policy products_founder_all on public.products
  for all to authenticated using (true) with check (true);

create policy enquiries_founder_all on public.enquiries
  for all to authenticated using (true) with check (true);

create policy projects_founder_all on public.projects
  for all to authenticated using (true) with check (true);

create policy hardware_sets_founder_all on public.hardware_sets
  for all to authenticated using (true) with check (true);

create policy hardware_set_line_items_founder_all on public.hardware_set_line_items
  for all to authenticated using (true) with check (true);

create policy doors_founder_all on public.doors
  for all to authenticated using (true) with check (true);

create policy quotes_founder_all on public.quotes
  for all to authenticated using (true) with check (true);

create policy quote_origins_founder_all on public.quote_origins
  for all to authenticated using (true) with check (true);

create policy quote_line_items_founder_all on public.quote_line_items
  for all to authenticated using (true) with check (true);

create policy business_parameters_founder_all on public.business_parameters
  for all to authenticated using (true) with check (true);

create policy parameter_audit_log_founder_all on public.parameter_audit_log
  for all to authenticated using (true) with check (true);

create policy override_log_founder_all on public.override_log
  for all to authenticated using (true) with check (true);

create policy invoices_founder_all on public.invoices
  for all to authenticated using (true) with check (true);

create policy payments_founder_all on public.payments
  for all to authenticated using (true) with check (true);

create policy price_file_uploads_founder_all on public.price_file_uploads
  for all to authenticated using (true) with check (true);

create policy extracted_prices_founder_all on public.extracted_prices
  for all to authenticated using (true) with check (true);

create policy orders_founder_all on public.orders
  for all to authenticated using (true) with check (true);

create policy actual_costs_founder_all on public.actual_costs
  for all to authenticated using (true) with check (true);

create policy articles_founder_all on public.articles
  for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Anonymous INSERT-only on enquiries (portal intake, §5.4). Column-level
-- restriction via WITH CHECK: an anonymous submitter can only ever create a
-- brand-new, unmatched, unconverted enquiry — cannot set matched_company_id,
-- project_id, or status to anything other than 'new', and cannot mark it
-- pre-reviewed. No anon SELECT/UPDATE/DELETE policy exists, so RLS denies
-- those outright (default-deny once RLS is enabled).
-- ----------------------------------------------------------------------------
create policy enquiries_anon_insert_only on public.enquiries
  for insert to anon
  with check (
    status = 'new'
    and matched_company_id is null
    and project_id is null
  );

-- Explicit table-level grants. RLS policies only take effect once the role
-- has the underlying SQL privilege; Supabase's default `anon`/`authenticated`
-- roles are broad at the schema level already, but we grant explicitly here
-- so this migration is self-contained and correct even on a bare Postgres.
grant usage on schema public to anon, authenticated;

grant insert (
  pathway, company_name, contact_name, contact_email, contact_phone,
  project_details, delivery_timeframe, building_type,
  failing_hardware_description, urgency_flag, retrofit_pathway,
  uploaded_file_paths, line_items_structured, honeypot_tripped,
  status, matched_company_id, project_id
) on public.enquiries to anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ============================================================================
-- Storage bucket policies (storage.objects).
--
-- NOTE: bucket *creation* itself is best done via the Supabase dashboard or
-- CLI (`supabase storage buckets create ...`) rather than raw SQL, since the
-- dashboard also wires up the correct default file-size/MIME restrictions.
-- The inserts below are idempotent and will create the buckets if they don't
-- already exist, so this migration is still runnable standalone; if the
-- buckets already exist from a dashboard action, these are no-ops.
--
-- Buckets:
--   enquiry-uploads  — public portal file uploads (hardware schedules, PDFs,
--                       photos). Anonymous INSERT only, no anonymous read.
--                       Founders (authenticated) get full CRUD for review.
--   quote-pdfs       — rendered quote/invoice PDFs. Founders only; no public
--                       access (PDFs are delivered by emailed link/attachment
--                       via Resend, not by public URL, per §10 — clients do
--                       not get portal logins in Phase 1).
--   price-files       — Phase 2 supplier price-file uploads. Founders only.
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('enquiry-uploads', 'enquiry-uploads', false),
  ('quote-pdfs', 'quote-pdfs', false),
  ('price-files', 'price-files', false)
on conflict (id) do nothing;

-- enquiry-uploads: anon can INSERT (upload) only.
create policy enquiry_uploads_anon_insert on storage.objects
  for insert to anon
  with check (bucket_id = 'enquiry-uploads');

-- enquiry-uploads: founders full access (review, download, delete stale files).
create policy enquiry_uploads_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'enquiry-uploads')
  with check (bucket_id = 'enquiry-uploads');

-- quote-pdfs: founders only, full access.
create policy quote_pdfs_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'quote-pdfs')
  with check (bucket_id = 'quote-pdfs');

-- price-files: founders only, full access (Phase 2, specced now).
create policy price_files_founder_all on storage.objects
  for all to authenticated
  using (bucket_id = 'price-files')
  with check (bucket_id = 'price-files');

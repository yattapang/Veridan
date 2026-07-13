# Supabase — Veridan Limited

This directory holds the Postgres schema, RLS policies, and parameter seed
for the Veridan app, as SQL migrations under `supabase/migrations/`. They are
numbered so they apply in order:

1. `20260713000001_schema.sql` — all Phase 1 tables (suppliers → users) plus
   the Phase 2/3 tables specced in build-plan §1.18 (invoices, payments,
   price file uploads/extractions, orders, actual costs, articles), the
   `pipeline_view` view, indexes, and CHECK constraints for status fields.
2. `20260713000002_rls.sql` — enables RLS on every table, grants authenticated
   founders (Ken, Kaylia) full CRUD everywhere, restricts the `anon` role to
   an INSERT-only, column-restricted policy on `enquiries`, and sets up
   Storage bucket policies (`enquiry-uploads`, `quote-pdfs`, `price-files`).
3. `20260713000003_seed_parameters.sql` — seeds `business_parameters` with
   every confirmed default from PRD §7 / build-plan Task 6.

## Applying the migrations

### Option A — Supabase CLI (recommended)

```bash
# one-time: link this repo to the founders' Supabase project
supabase link --project-ref <your-project-ref>

# apply all pending migrations in supabase/migrations/, in filename order
supabase db push
```

If you're iterating locally with the Supabase CLI's local dev stack instead:

```bash
supabase start          # spins up local Postgres/Auth/Storage via Docker
supabase migration up   # applies supabase/migrations/*.sql to the local db
```

### Option B — Dashboard SQL editor

If the CLI isn't set up yet, open the Supabase project's SQL Editor and run
each file's contents **in order** (`...0001` schema, then `...0002` rls, then
`...0003` seed). Running them out of order will fail — the RLS migration
references tables created by the schema migration, and the seed migration
references the `business_parameters` table.

## After applying: generate TypeScript types

Once the project is linked and the migrations are applied, generate the typed
Supabase client types used by `lib/supabase/*`:

```bash
supabase gen types typescript --linked > lib/supabase/database.types.ts
```

This is a one-time (then repeat-after-schema-change) step done once the
project is actually connected — it isn't run as part of this migration set.

## Notes for founders / future agents

- **FX rate placeholder:** `fx_bank_sell_rate_usd_jmd` is seeded at 162 (the
  workbook's snapshot value). Update it from the live CIBC Caribbean sell
  rate before running any real quote — there is no scheduled fetch in
  Phase 1.
- **Company details block:** `company_details` is seeded with the company
  name only; address/TRN/phone/email are empty placeholders pending founder
  input, needed before quote/invoice PDFs are production-ready.
- **Storage buckets:** the RLS migration creates the three buckets it needs
  (`enquiry-uploads`, `quote-pdfs`, `price-files`) via `insert into
  storage.buckets ... on conflict do nothing`, so it's safe to run even if a
  bucket was already created by hand by mistake. If your Supabase project
  disallows direct `storage.buckets` inserts under your role, create the
  buckets via the dashboard (Storage → New bucket, all three non-public)
  first, then re-run migration 2 — the `on conflict do nothing` makes it
  idempotent either way.
- **Snapshot rule:** `quotes.parameters_snapshot` and `quotes.fx_snapshot`
  are populated by the application at quote-creation time by copying the
  live `business_parameters` values — the schema does not enforce this via
  trigger, since the copy needs to happen once, at creation, not on every
  read. Application code must never read live `business_parameters` for an
  already-created quote's calculations.

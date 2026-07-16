# Operations Runbook

Practical reference for running, backing up, and maintaining the Veridan
app in production. Written for the founders (Ken, Kaylia) and for any
future Claude Code session picking this up — not a design document (see
`Veridan_Build_Plan_v1.md` in the parent Deliverables folder for that).

## 1. System of record

Supabase Postgres is the **only** system of record for quotes, clients,
and business parameters (Zoho/HubSpot were dropped per the build plan's
Decisions 1–2). There is no secondary copy anywhere except whatever backup
routine you run from this document. Treat backups as non-optional.

## 2. Backups / data export

### Automatic backups (check this first)

Supabase's own point-in-time recovery / daily backup schedule depends on
your project's pricing tier:

1. Open the Supabase dashboard → **Project Settings → Backups**.
2. Confirm a backup schedule is shown as **enabled**. Free-tier projects
   get daily backups retained for a short window; Pro tier adds
   point-in-time recovery. If the project is still on the free tier at
   launch, treat the manual export below as your real backup plan, not a
   fallback.

### Manual export (pg_dump via the connection pooler)

Use this before any risky operation (a migration, a bulk data fix) and on
a regular cadence if the automatic backup tier is insufficient.

1. In the Supabase dashboard, go to **Project Settings → Database →
   Connection string** and copy the **connection pooler** URI (port 6543,
   `?pgbouncer=true`) — not the direct connection, which is not meant for
   long-running dump processes.
2. Run:

   ```bash
   pg_dump "postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres?sslmode=require" \
     --no-owner --no-privileges \
     -f veridan-backup-$(date +%Y%m%d).sql
   ```

3. Store the resulting `.sql` file somewhere outside Supabase (a founder's
   own encrypted drive, a private cloud bucket) — a backup that lives only
   inside the system it's backing up isn't a backup.
4. To restore into a fresh Postgres instance:

   ```bash
   psql "postgresql://postgres:<password>@<host>:5432/postgres" -f veridan-backup-YYYYMMDD.sql
   ```

### What's in scope

Every table matters (quotes reference companies/products/suppliers by
FK), so a full-database `pg_dump` is the right unit — there's no safe way
to export "just quotes" without the referenced rows becoming orphaned on
restore.

## 3. Migrations

All schema changes live in `supabase/migrations/*.sql`, applied in
filename order. Full instructions: `supabase/README.md`. Summary:

```bash
# link once
supabase link --project-ref <your-project-ref>

# apply everything pending
supabase db push
```

Never hand-edit the schema directly in the Supabase dashboard's table
editor for anything beyond a one-off data fix — schema changes belong in
a new numbered migration file so the history stays reproducible from a
clean database.

After any schema change, regenerate the typed client:

```bash
supabase gen types typescript --linked > lib/supabase/database.types.ts
```

## 4. Environment variable inventory

All required variables are listed in `.env.example` (copy to `.env.local`
for local dev; set the same keys in the Vercel dashboard for production —
**never commit `.env.local`**, it is gitignored).

| Variable | Where it's used | Sensitivity |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server Supabase clients | Public (safe to expose — it's just the project URL) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server Supabase clients (RLS-protected) | Public by design — RLS is the real gate, not this key's secrecy |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/admin.ts` only, server-side | **Secret.** Bypasses RLS entirely. Never in a `NEXT_PUBLIC_*` var, never logged, never sent to the browser. |
| `RESEND_API_KEY` | `lib/email.ts`, server-side only | **Secret.** Rotate immediately if ever exposed. |
| `NEXT_PUBLIC_SITE_URL` | Metadata, sitemap, email links | Public |

A repo-wide grep confirms no secret values are ever passed to
`console.log`/`console.error` — only error *messages* (e.g. Resend/Supabase
error text) are logged, never API keys or full env dumps. Keep it that
way: never `console.log(process.env)` or log a full request/response
object that might contain a key.

## 5. Rotating keys

**Supabase service-role key or anon key:**
1. Supabase dashboard → **Project Settings → API** → regenerate the key.
2. Update `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
   the Vercel project's Environment Variables.
3. Redeploy (Vercel → Deployments → Redeploy on the latest production
   deployment) so the new value takes effect — env var changes don't
   retroactively apply to already-running instances.

**Resend API key:**
1. Resend dashboard → **API Keys** → revoke the old key, create a new one.
2. Update `RESEND_API_KEY` in Vercel, redeploy.
3. Confirm the sending domain (SPF/DKIM) is still verified after any
   account-level change — key rotation shouldn't affect it, but check.

**Founder passwords (Supabase Auth):** each founder manages their own via
Supabase Auth's password reset flow at `/login` (or the Supabase dashboard
if locked out) — nothing in this app stores passwords itself.

## 6. Parity-test cleanup

The §6.5 parity test (`scripts/parity-test.mts`) seeds a fixture company
named **"PARITY TEST — Workbook"** (plus its project/quote) to reproduce
the real workbook numbers end-to-end. This fixture is left in the
database intentionally after a successful run, for inspection — **do not
delete it manually** unless you're intentionally re-running or retiring
the test, since it's the durable evidence the acceptance gate passed.

To remove it (e.g. before a final production data wipe, or to re-run the
test clean):

```bash
npx tsx scripts/parity-test.mts --cleanup
```

This deletes only rows scoped to that fixture company (matched by name +
an internal marker) — it does not touch any other company, project, or
quote.

## 7. Logging conventions

Server-side errors are logged via `console.error` with a stable
`[veridan:<area>]` prefix (e.g. `[veridan:email]`, `[veridan:enquiries-submit]`,
`[veridan:admin-error]`) so they're greppable in Vercel's log viewer or
CLI (`vercel logs --search "[veridan:"`). When adding new server code that
can fail in a way worth knowing about in production, follow the same
pattern rather than a bare `console.error("failed:", err)`.

## 8. Quick reference — common operational tasks

| Task | Command / location |
|---|---|
| Check backup schedule | Supabase dashboard → Project Settings → Backups |
| Manual full export | `pg_dump` via pooler URL (§2 above) |
| Apply a new migration | `supabase db push` |
| Regenerate DB types | `supabase gen types typescript --linked > lib/supabase/database.types.ts` |
| Rotate a key | See §5, then redeploy on Vercel |
| Remove parity-test fixture | `npx tsx scripts/parity-test.mts --cleanup` |
| Update the CIBC FX rate | `/admin/parameters` → `fx_bank_sell_rate_usd_jmd` (manual, no scheduled fetch in Phase 1) |
| View production error logs | Vercel dashboard → Project → Logs, or `vercel logs` |

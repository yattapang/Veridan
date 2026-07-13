import { createClient } from "@/lib/supabase/server";
import type { BusinessParameterRow } from "@/lib/supabase/types";
import { PARAMETER_GROUPS } from "@/lib/parameter-groups";
import { ParameterRow } from "./ParameterRow";

export const metadata = {
  title: "Business Parameters",
};

function InstructiveMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-xl rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale px-5 py-4">
      <p className="text-sm font-medium text-veridan-ink">{title}</p>
      <p className="mt-1 text-sm text-veridan-warm-gray">{body}</p>
    </div>
  );
}

export default async function ParametersPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">
          Business Parameters
        </h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let data: BusinessParameterRow[] | null = null;
  let loadError: string | null = null;

  try {
    const { data: rows, error } = await supabase
      .from("business_parameters")
      .select("*")
      .order("key");

    if (error) {
      loadError = error.message;
    } else {
      data = rows as BusinessParameterRow[];
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">
          Business Parameters
        </h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The parameters table couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">
          Business Parameters
        </h1>
        <InstructiveMessage
          title="No parameters found"
          body="business_parameters is empty. Run supabase/migrations/20260713000003_seed_parameters.sql against this database to load the PRD §7 defaults."
        />
      </div>
    );
  }

  const byKey = new Map(data.map((p) => [p.key, p]));
  const groupedKeys = new Set(PARAMETER_GROUPS.flatMap((g) => g.keys));
  const ungrouped = data.filter((p) => !groupedKeys.has(p.key));

  const groups = [
    ...PARAMETER_GROUPS.map((g) => ({
      label: g.label,
      params: g.keys.map((k) => byKey.get(k)).filter((p): p is BusinessParameterRow => Boolean(p)),
    })),
    ...(ungrouped.length > 0 ? [{ label: "Other", params: ungrouped }] : []),
  ].filter((g) => g.params.length > 0);

  // Audit log view (route map §2 — "/admin/parameters — ... + audit log
  // view"). Best-effort: a failure here shouldn't take down the editor.
  type AuditRow = {
    id: string;
    parameter_key: string;
    old_value: unknown;
    new_value: unknown;
    changed_at: string;
    reason: string | null;
    changed_by: string | null;
  };
  let auditRows: AuditRow[] = [];
  let auditError: string | null = null;
  try {
    const { data: audit, error } = await supabase
      .from("parameter_audit_log")
      .select("id, parameter_key, old_value, new_value, changed_at, reason, changed_by")
      .order("changed_at", { ascending: false })
      .limit(20);
    if (error) auditError = error.message;
    else auditRows = (audit as AuditRow[]) ?? [];
  } catch (err) {
    auditError = err instanceof Error ? err.message : "Unknown error loading audit log.";
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Business Parameters</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Editing a parameter here only affects quotes created after the change
        — every quote snapshots the full parameter set at creation time, so
        past quotes never move (PRD §7 snapshot rule). Every save is recorded
        in the audit log.
      </p>

      <div className="mt-8 space-y-10">
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
              {group.label}
            </h2>
            <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
              {group.params.map((param) => (
                <ParameterRow key={param.id} param={param} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-12">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Recent changes
        </h2>
        {auditError ? (
          <InstructiveMessage
            title="Audit log unavailable"
            body={`Recent changes couldn't be loaded (${auditError}).`}
          />
        ) : auditRows.length === 0 ? (
          <p className="text-sm text-veridan-warm-gray">No parameter changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-veridan-warm-gray-light rounded-md border border-veridan-warm-gray-light bg-white">
            {auditRows.map((row) => (
              <li key={row.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-mono text-xs text-veridan-ink">{row.parameter_key}</p>
                  <p className="text-xs text-veridan-warm-gray">
                    {new Date(row.changed_at).toLocaleString("en-JM", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                <p className="mt-1 break-words text-xs text-veridan-warm-gray">
                  <span className="line-through">{JSON.stringify(row.old_value)}</span>
                  {" -> "}
                  <span className="text-veridan-ink">{JSON.stringify(row.new_value)}</span>
                </p>
                {row.reason && (
                  <p className="mt-1 text-xs italic text-veridan-warm-gray">“{row.reason}”</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

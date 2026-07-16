import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  BusinessParameterRow,
  CompanyRow,
  HardwareSetLineItemWithDetails,
  HardwareSetRow,
  ProjectWithCompany,
  QuoteRow,
} from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { nextSetCode, summarizeSetUsd, type SupplierFxRates } from "@/lib/hardware-sets";
import { ProjectHeaderForm } from "./ProjectHeaderForm";
import { AddHardwareSetForm } from "./AddHardwareSetForm";
import { CloneSetForm, type CloneableSetOption } from "./CloneSetForm";
import { HardwareSetCard } from "./HardwareSetCard";
import { CreateQuoteButton } from "./CreateQuoteButton";
import { CreateLineItemQuoteButton } from "./CreateLineItemQuoteButton";
import { QUOTE_STATUS_LABELS, QUOTE_STATUS_BADGE, formatUsd, formatJmd } from "@/lib/quotes/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Project · ${id}` };
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  closed: "Closed",
  archived: "Archived",
};

const TYPE_LABELS: Record<string, string> = {
  new_construction: "New construction",
  retrofit: "Retrofit",
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Project</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let project: ProjectWithCompany | null = null;
  let loadError: string | null = null;

  try {
    const { data, error } = await supabase
      .from("projects")
      .select("*, companies(id, name)")
      .eq("id", id)
      .maybeSingle();
    if (error) loadError = error.message;
    else project = data as unknown as ProjectWithCompany;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Project</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The project record couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  if (!project) {
    notFound();
  }

  const [companiesResult, setsResult, cloneOptionsResult, fxParamResult, doorCountResult, quotesResult] = await Promise.all([
    supabase.from("companies").select("*").order("name"),
    supabase.from("hardware_sets").select("*").eq("project_id", id).order("code"),
    supabase
      .from("hardware_sets")
      .select("id, code, name, project_id, projects(id, name)")
      .neq("project_id", id)
      .not("project_id", "is", null)
      .order("code"),
    supabase.from("business_parameters").select("*").eq("key", "supplier_fx_rates").maybeSingle(),
    supabase.from("doors").select("id", { count: "exact", head: true }).eq("project_id", id),
    supabase.from("quotes").select("*").eq("project_id", id).order("created_at", { ascending: false }),
  ]);

  const doorCount = doorCountResult.count ?? 0;
  const quotes = (quotesResult.data as QuoteRow[]) ?? [];
  const assignedDoorCount = doorCount; // doors exist; quote materialization uses those with a set assigned

  const companies = (companiesResult.data as CompanyRow[]) ?? [];
  const sets = (setsResult.data as HardwareSetRow[]) ?? [];

  const cloneOptions: CloneableSetOption[] = ((cloneOptionsResult.data ?? []) as unknown as Array<{
    id: string;
    code: string;
    name: string | null;
    projects: { id: string; name: string } | null;
  }>).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    projectName: row.projects?.name ?? "Unknown project",
  }));

  const fxParam = fxParamResult.data as BusinessParameterRow | null;
  const fxRates: SupplierFxRates =
    fxParam && fxParam.value.type === "table" && typeof fxParam.value.value === "object"
      ? (fxParam.value.value as SupplierFxRates)
      : {};

  let lineItemsBySet = new Map<string, HardwareSetLineItemWithDetails[]>();
  let lineItemsError: string | null = null;

  if (sets.length > 0) {
    const { data: lines, error } = await supabase
      .from("hardware_set_line_items")
      .select(
        "*, products(id, description, manufacturer, product_ref, catalogue_ref, unit, unit_cost, cost_currency), suppliers(id, name, default_currency)"
      )
      .in(
        "hardware_set_id",
        sets.map((s) => s.id)
      );

    if (error) {
      lineItemsError = error.message;
    } else {
      const typed = (lines ?? []) as unknown as HardwareSetLineItemWithDetails[];
      lineItemsBySet = new Map(sets.map((s) => [s.id, typed.filter((l) => l.hardware_set_id === s.id)]));
    }
  }

  const suggestedCode = nextSetCode(sets.map((s) => s.code));

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/projects"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← All projects
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-veridan-ink">{project.name}</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        {project.companies ? (
          <Link href={`/admin/companies/${project.companies.id}`} className="underline underline-offset-2 hover:text-veridan-ink">
            {project.companies.name}
          </Link>
        ) : (
          "Unknown company"
        )}
        {" · "}
        {TYPE_LABELS[project.project_type] ?? project.project_type}
        {" · "}
        {STATUS_LABELS[project.status] ?? project.status}
        {project.enquiry_id && (
          <>
            {" · "}
            <Link
              href={`/admin/enquiries/${project.enquiry_id}`}
              className="underline underline-offset-2 hover:text-veridan-ink"
            >
              from enquiry
            </Link>
          </>
        )}
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Project details
        </h2>
        <ProjectHeaderForm project={project} companies={companies} />
      </section>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
              Door Register
            </h2>
            <p className="mt-1 text-xs text-veridan-warm-gray">
              {doorCount} door{doorCount === 1 ? "" : "s"} entered · floor, door number, auto-derived type,
              location, and assigned hardware set.
            </p>
          </div>
          <Link
            href={`/admin/projects/${project.id}/doors`}
            className="shrink-0 rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90"
          >
            Open Door Register →
          </Link>
        </div>
      </section>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
              Quotes
            </h2>
            <p className="mt-1 text-xs text-veridan-warm-gray">
              Door Register mode materializes line items from the doors&apos; hardware sets.
              Line-item mode (retrofit/simple jobs) starts empty — add product or ad-hoc lines
              directly on the quote. Both snapshot parameters + FX and share the same engine.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <CreateQuoteButton
              projectId={project.id}
              disabled={assignedDoorCount === 0}
              disabledReason={
                assignedDoorCount === 0
                  ? "Add doors and assign hardware sets in the Door Register first."
                  : undefined
              }
            />
            <CreateLineItemQuoteButton projectId={project.id} />
          </div>
        </div>

        {quotes.length === 0 ? (
          <p className="mt-4 text-sm text-veridan-warm-gray">No quotes for this project yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-veridan-warm-gray-light border-t border-veridan-warm-gray-light">
            {quotes.map((quote) => (
              <li key={quote.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/admin/quotes/${quote.id}`}
                    className="text-sm font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
                  >
                    {quote.quote_ref}
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${QUOTE_STATUS_BADGE[quote.status]}`}
                  >
                    {QUOTE_STATUS_LABELS[quote.status]}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-veridan-warm-gray">
                    {quote.quote_mode === "line_item" ? "Line item" : "Door Register"}
                  </span>
                  {quote.revision_number > 1 && (
                    <span className="text-xs text-veridan-warm-gray">rev {quote.revision_number}</span>
                  )}
                </div>
                <div className="text-xs text-veridan-warm-gray">
                  Landed {formatUsd(quote.total_landed_usd)} · Client {formatJmd(quote.total_client_jmd)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Hardware sets
        </h2>
        <p className="mb-4 text-xs text-veridan-warm-gray">
          Named packages (HW01, HW02…) composed of product × qty lines; lines
          within one set may mix suppliers/origins (PRD §6.1). Subtotals
          below are indicative only, converted via the current supplier FX
          parameter table — real landed cost comes from the quote engine.
        </p>

        {lineItemsError && (
          <div className="mb-4">
            <InstructiveMessage
              title="Line items unavailable"
              body={`Couldn't load line items (${lineItemsError}). Set summaries may be incomplete.`}
            />
          </div>
        )}

        {sets.length === 0 ? (
          <InstructiveMessage
            title="No hardware sets yet"
            body="Add the first set below, or clone one from a previous project."
          />
        ) : (
          <ul className="mb-6 rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {sets.map((set) => (
              <HardwareSetCard
                key={set.id}
                projectId={project.id}
                set={set}
                summary={summarizeSetUsd(lineItemsBySet.get(set.id) ?? [], fxRates)}
              />
            ))}
          </ul>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
              Add a new set
            </h3>
            <AddHardwareSetForm projectId={project.id} suggestedCode={suggestedCode} />
          </div>
          <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
              Clone from another project
            </h3>
            <CloneSetForm projectId={project.id} options={cloneOptions} />
          </div>
        </div>
      </section>
    </div>
  );
}

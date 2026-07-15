import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  BusinessParameterRow,
  CompanyRow,
  HardwareSetLineItemWithDetails,
  HardwareSetRow,
  ProjectWithCompany,
} from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { nextSetCode, summarizeSetUsd, type SupplierFxRates } from "@/lib/hardware-sets";
import { ProjectHeaderForm } from "./ProjectHeaderForm";
import { AddHardwareSetForm } from "./AddHardwareSetForm";
import { CloneSetForm, type CloneableSetOption } from "./CloneSetForm";
import { HardwareSetCard } from "./HardwareSetCard";

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

  const [companiesResult, setsResult, cloneOptionsResult, fxParamResult] = await Promise.all([
    supabase.from("companies").select("*").order("name"),
    supabase.from("hardware_sets").select("*").eq("project_id", id).order("code"),
    supabase
      .from("hardware_sets")
      .select("id, code, name, project_id, projects(id, name)")
      .neq("project_id", id)
      .not("project_id", "is", null)
      .order("code"),
    supabase.from("business_parameters").select("*").eq("key", "supplier_fx_rates").maybeSingle(),
  ]);

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

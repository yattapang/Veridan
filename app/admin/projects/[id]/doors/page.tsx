import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  BusinessParameterRow,
  DoorWithHardwareSet,
  HardwareSetLineItemWithDetails,
  HardwareSetRow,
  ProjectWithCompany,
} from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { countDoorsByHardwareSet } from "@/lib/doors";
import { summarizeSetUsd, type SupplierFxRates } from "@/lib/hardware-sets";
import { DoorAddForm } from "./DoorAddForm";
import { DoorRow } from "./DoorRow";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Door Register · ${id}` };
}

export default async function DoorRegisterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Door Register</h1>
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
      .eq("id", projectId)
      .maybeSingle();
    if (error) loadError = error.message;
    else project = data as unknown as ProjectWithCompany;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Door Register</h1>
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

  const [doorsResult, setsResult, fxParamResult] = await Promise.all([
    supabase
      .from("doors")
      .select("*, hardware_sets(id, code, name)")
      .eq("project_id", projectId)
      .order("sort_order"),
    supabase.from("hardware_sets").select("*").eq("project_id", projectId).order("code"),
    supabase.from("business_parameters").select("*").eq("key", "supplier_fx_rates").maybeSingle(),
  ]);

  const doors = (doorsResult.data as unknown as DoorWithHardwareSet[]) ?? [];
  const doorsError = doorsResult.error?.message ?? null;
  const sets = (setsResult.data as HardwareSetRow[]) ?? [];

  const fxParam = fxParamResult.data as BusinessParameterRow | null;
  const fxRates: SupplierFxRates =
    fxParam && fxParam.value.type === "table" && typeof fxParam.value.value === "object"
      ? (fxParam.value.value as SupplierFxRates)
      : {};

  // Indicative per-door USD subtotal comes from the assigned hardware set's
  // own line items (the set is the per-door package; see lib/hardware-sets),
  // so fetch every set's line items once and key the summary by set id.
  let subtotalsBySet = new Map<string, ReturnType<typeof summarizeSetUsd>>();
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
      subtotalsBySet = new Map(
        sets.map((s) => [s.id, summarizeSetUsd(typed.filter((l) => l.hardware_set_id === s.id), fxRates)])
      );
    }
  }

  const { counts, unassigned } = countDoorsByHardwareSet(doors);
  const setById = new Map(sets.map((s) => [s.id, s]));

  return (
    <div className="max-w-5xl">
      <Link
        href={`/admin/projects/${projectId}`}
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← Back to project
      </Link>

      <h1 className="mt-3 text-2xl font-semibold text-veridan-ink">Door Register</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        {project.name} · {doors.length} door{doors.length === 1 ? "" : "s"}
      </p>

      {doorsError && (
        <div className="mt-4">
          <InstructiveMessage
            title="Doors unavailable"
            body={`Couldn't load the door register (${doorsError}). Check that the doors table exists and migrations are applied.`}
          />
        </div>
      )}
      {lineItemsError && (
        <div className="mt-4">
          <InstructiveMessage
            title="Hardware set costs unavailable"
            body={`Couldn't load hardware set line items (${lineItemsError}). Door subtotals may be missing.`}
          />
        </div>
      )}

      {sets.length === 0 && (
        <div className="mt-4">
          <InstructiveMessage
            title="No hardware sets on this project yet"
            body="You can still add doors and fill in numbers/floors now, but assign a hardware set later from the project page to see indicative pricing."
          />
        </div>
      )}

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Register summary
        </h2>
        {doors.length === 0 ? (
          <p className="text-sm text-veridan-warm-gray">Add the first door below to see a summary here.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-veridan-ink">
            {[...counts.entries()].map(([setId, count]) => {
              const set = setById.get(setId);
              return (
                <li key={setId}>
                  <span className="font-medium">{set ? set.code : "Unknown set"}</span> × {count} door
                  {count === 1 ? "" : "s"}
                </li>
              );
            })}
            {unassigned > 0 && (
              <li className="font-medium text-red-600">
                {unassigned} door{unassigned === 1 ? "" : "s"} with no hardware set
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Doors
        </h2>
        {doors.length === 0 ? (
          <InstructiveMessage
            title="No doors yet"
            body="Add the first door below. Floor, door number, and hardware set are all you need to get going — location and set can be filled in later."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[720px] table-auto border-collapse text-left">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Floor</th>
                  <th className="px-3 py-2">Door #</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Hardware set</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {doors.map((door, index) => {
                  const subtotal = door.hardware_set_id ? subtotalsBySet.get(door.hardware_set_id) : undefined;
                  return (
                    <DoorRow
                      key={door.id}
                      projectId={projectId}
                      door={door}
                      rowNumber={index + 1}
                      sets={sets}
                      subtotalUsd={subtotal && subtotal.lineCount > 0 ? subtotal.subtotalUsd : null}
                      subtotalIncomplete={subtotal?.incomplete ?? false}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Add a door
        </h2>
        <DoorAddForm projectId={projectId} sets={sets} />
      </section>
    </div>
  );
}

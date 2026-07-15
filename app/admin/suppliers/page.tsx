import { createClient } from "@/lib/supabase/server";
import type { SupplierRow } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { SupplierForm } from "./SupplierForm";
import { SupplierListItem } from "./SupplierListItem";

export const metadata = {
  title: "Suppliers",
};

export default async function SuppliersPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Suppliers</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let data: SupplierRow[] | null = null;
  let loadError: string | null = null;

  try {
    const { data: rows, error } = await supabase
      .from("suppliers")
      .select("*")
      .order("name");

    if (error) {
      loadError = error.message;
    } else {
      data = rows as SupplierRow[];
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Suppliers</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The suppliers table couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const suppliers = data ?? [];
  const active = suppliers.filter((s) => s.active);
  const archived = suppliers.filter((s) => !s.active);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Suppliers</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Origin, default currency, and lead time set here become the default
        for products and shipment origins on new quotes. Archiving keeps a
        supplier&apos;s history intact on past quotes and products while hiding
        it from new selections.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Add a supplier
        </h2>
        <SupplierForm />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Active suppliers
        </h2>
        {active.length === 0 ? (
          <InstructiveMessage
            title="No suppliers yet"
            body="Add your first supplier above — the Hardware Library (products) and hardware sets both reference suppliers, so this list is worth building out first."
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {active.map((supplier) => (
              <SupplierListItem key={supplier.id} supplier={supplier} />
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
            Archived
          </h2>
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {archived.map((supplier) => (
              <SupplierListItem key={supplier.id} supplier={supplier} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

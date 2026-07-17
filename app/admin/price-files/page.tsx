import { createClient } from "@/lib/supabase/server";
import type { PriceFileUploadWithDetails, SupplierRow } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { UploadForm } from "./UploadForm";
import { PriceFileListItem } from "./PriceFileListItem";

export const metadata = {
  title: "Price Files",
};

export default async function PriceFilesPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Price Files</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let uploads: PriceFileUploadWithDetails[] | null = null;
  let loadError: string | null = null;

  try {
    const { data, error } = await supabase
      .from("price_file_uploads")
      .select("*, suppliers(id, name), users(id, email, display_name)")
      .order("uploaded_at", { ascending: false });

    if (error) {
      loadError = error.message;
    } else {
      uploads = data as PriceFileUploadWithDetails[];
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Price Files</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The price file uploads table couldn't be loaded (${loadError}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const { data: suppliersData } = await supabase
    .from("suppliers")
    .select("*")
    .eq("active", true)
    .order("name");
  const suppliers = (suppliersData as SupplierRow[]) ?? [];

  const rows = uploads ?? [];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Price Files</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Upload a supplier quote or price list (PDF, Excel, CSV, or a photo) to
        seed the extraction pipeline. Extraction and review land in a later
        build — for now, an upload records the file and its metadata.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Upload a price file
        </h2>
        <UploadForm suppliers={suppliers} />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Uploads
        </h2>
        {rows.length === 0 ? (
          <InstructiveMessage
            title="No price files uploaded yet"
            body="Upload a supplier quote or price list above to get started."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-veridan-warm-gray-pale text-xs uppercase tracking-wide text-veridan-warm-gray">
                <tr>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Uploaded</th>
                  <th className="px-4 py-3 font-medium">Uploaded by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((upload) => (
                  <PriceFileListItem key={upload.id} upload={upload} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

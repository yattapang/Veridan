import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { InvoiceWithRefs } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { INVOICE_STATUS_BADGE, INVOICE_STATUS_LABELS, INVOICE_TYPE_LABELS } from "@/lib/invoices/format";
import { formatJmd } from "@/lib/quotes/format";

export const metadata = {
  title: "Invoices",
};

export default async function InvoicesPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Invoices</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let invoices: InvoiceWithRefs[] = [];
  let loadError: string | null = null;
  try {
    const { data, error } = await supabase
      .from("invoices")
      .select("*, quotes(id, quote_ref), projects(id, name), companies(id, name)")
      .order("created_at", { ascending: false });
    if (error) loadError = error.message;
    else invoices = (data as unknown as InvoiceWithRefs[]) ?? [];
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Invoices</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The invoices table couldn't be loaded (${loadError}). Check that migrations are applied and reload.`}
        />
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Invoices</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Deposit invoices are created automatically when a quote is accepted; balance invoices are
        created when a quote is marked customs cleared. Both are always JMD at the source quote&apos;s
        locked FX rate.
      </p>

      <section className="mt-8">
        {invoices.length === 0 ? (
          <InstructiveMessage
            title="No invoices yet"
            body="Accept a quote to generate its deposit invoice, or mark an accepted quote's customs cleared to generate its balance invoice."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[840px] table-auto border-collapse text-left">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Quote</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2 text-right">Amount JMD</th>
                  <th className="px-3 py-2">Issued</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-veridan-warm-gray-light last:border-b-0">
                    <td className="px-3 py-2 text-sm font-medium">
                      <Link
                        href={`/admin/invoices/${invoice.id}`}
                        className="text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
                      >
                        {invoice.invoice_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-sm text-veridan-warm-gray">
                      {INVOICE_TYPE_LABELS[invoice.invoice_type]}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${INVOICE_STATUS_BADGE[invoice.status]}`}
                      >
                        {INVOICE_STATUS_LABELS[invoice.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-veridan-ink">
                      {invoice.quotes ? (
                        <Link
                          href={`/admin/quotes/${invoice.quotes.id}`}
                          className="underline underline-offset-2 hover:text-veridan-accent"
                        >
                          {invoice.quotes.quote_ref}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-veridan-ink">
                      {invoice.projects ? (
                        <Link
                          href={`/admin/projects/${invoice.projects.id}`}
                          className="underline underline-offset-2 hover:text-veridan-accent"
                        >
                          {invoice.projects.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-veridan-warm-gray">
                      {invoice.companies?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-medium text-veridan-ink">
                      {formatJmd(invoice.amount_jmd, 2)}
                    </td>
                    <td className="px-3 py-2 text-sm text-veridan-warm-gray">
                      {invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

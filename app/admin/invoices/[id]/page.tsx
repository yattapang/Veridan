import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { InvoicePaymentRow, InvoiceWithRefs } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { INVOICE_STATUS_BADGE, INVOICE_STATUS_LABELS, INVOICE_TYPE_LABELS } from "@/lib/invoices/format";
import { computeRemainingBalanceJmd, sumPayments } from "@/lib/invoices/paymentStatus";
import { formatJmd, formatUsd } from "@/lib/quotes/format";
import { loadDefaultRecipientEmail } from "@/lib/quotes/persist";
import { signInvoicePdfUrl } from "@/lib/storage";
import { InvoiceActionsPanel } from "./InvoiceActionsPanel";
import { RecordPaymentForm } from "./RecordPaymentForm";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Invoice · ${id}` };
}

function supabaseUnconfigured() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Invoice</h1>
      <InstructiveMessage
        title="Supabase is not configured"
        body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
      />
    </div>
  );
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return supabaseUnconfigured();
  }

  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .select("*, quotes(id, quote_ref), projects(id, name), companies(id, name)")
    .eq("id", id)
    .maybeSingle();

  if (invoiceError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Invoice</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The invoice couldn't be loaded (${invoiceError.message}). Check that migrations are applied and reload.`}
        />
      </div>
    );
  }
  if (!invoiceData) notFound();
  const invoice = invoiceData as unknown as InvoiceWithRefs;

  // Chronological order (oldest first) so a running balance can be computed
  // in payment order, then the display list is reversed (most recent on
  // top) while each row keeps the running-balance value computed here.
  const [paymentsResult, defaultRecipientEmail, sentPdfUrl] = await Promise.all([
    supabase
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", id)
      .order("paid_at", { ascending: true })
      .order("created_at", { ascending: true }),
    invoice.status === "issued" ? loadDefaultRecipientEmail(supabase, invoice.company_id) : Promise.resolve(null),
    signInvoicePdfUrl(supabase, invoice.pdf_storage_path),
  ]);
  const { data: paymentsData, error: paymentsError } = paymentsResult;
  const paymentsChronological = (paymentsData as InvoicePaymentRow[]) ?? [];

  const canRecordPayment = ["issued", "sent", "partially_paid"].includes(invoice.status);
  const totalPaid = sumPayments(paymentsChronological.map((p) => p.amount_jmd));
  const balanceRemaining = computeRemainingBalanceJmd(invoice.amount_jmd, totalPaid);

  // Cumulative amount paid as of each payment (chronological order), built
  // via reduce rather than a reassigned loop variable so this stays a pure
  // derivation of paymentsChronological.
  const cumulativePaidAt = paymentsChronological.reduce<number[]>((acc, p) => {
    const runningTotal = (acc.length > 0 ? acc[acc.length - 1] : 0) + Number(p.amount_jmd);
    return [...acc, runningTotal];
  }, []);
  // Attach each payment's running balance (amount due minus everything paid
  // up to and including that payment), then reverse to most-recent-first for
  // display.
  const paymentsWithRunningBalance = paymentsChronological.map((p, i) => ({
    payment: p,
    runningBalance: computeRemainingBalanceJmd(invoice.amount_jmd, cumulativePaidAt[i]),
  }));
  const paymentsForDisplay = [...paymentsWithRunningBalance].reverse();

  return (
    <div className="max-w-4xl">
      <Link
        href="/admin/invoices"
        className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
      >
        ← All invoices
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-veridan-ink">{invoice.invoice_number}</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${INVOICE_STATUS_BADGE[invoice.status]}`}
        >
          {INVOICE_STATUS_LABELS[invoice.status]}
        </span>
        <span className="rounded-full bg-veridan-warm-gray-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-ink">
          {INVOICE_TYPE_LABELS[invoice.invoice_type]}
        </span>
      </div>

      <p className="mt-2 text-sm text-veridan-warm-gray">
        {invoice.quotes && (
          <>
            Quote{" "}
            <Link href={`/admin/quotes/${invoice.quotes.id}`} className="underline underline-offset-2 hover:text-veridan-ink">
              {invoice.quotes.quote_ref}
            </Link>{" "}
            ·{" "}
          </>
        )}
        {invoice.projects ? (
          <Link href={`/admin/projects/${invoice.projects.id}`} className="underline underline-offset-2 hover:text-veridan-ink">
            {invoice.projects.name}
          </Link>
        ) : (
          "No project"
        )}
        {invoice.companies && <> · {invoice.companies.name}</>}
      </p>

      {paymentsError && (
        <div className="mt-4">
          <InstructiveMessage
            title="Payment history could not be loaded"
            body={paymentsError.message}
          />
        </div>
      )}

      {/* Amounts breakdown */}
      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">Amounts</h2>
        <dl className="grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
          <dt className="text-veridan-warm-gray">Subtotal (JMD)</dt>
          <dd className="text-veridan-ink">{formatJmd(invoice.subtotal_jmd, 2)}</dd>
          <dt className="text-veridan-warm-gray">GCT (JMD)</dt>
          <dd className="text-veridan-ink">{formatJmd(invoice.gct_amount_jmd, 2)}</dd>
          <dt className="font-medium text-veridan-warm-gray">Amount due (JMD)</dt>
          <dd className="font-medium text-veridan-ink">{formatJmd(invoice.amount_jmd, 2)}</dd>
          <dt className="text-veridan-warm-gray">Amount (USD, informational)</dt>
          <dd className="text-veridan-ink">{formatUsd(invoice.amount_usd)}</dd>
          <dt className="text-veridan-warm-gray">Paid to date</dt>
          <dd className="text-veridan-ink">{formatJmd(totalPaid, 2)}</dd>
          <dt className="text-veridan-warm-gray">Balance remaining</dt>
          <dd className="text-veridan-ink">{formatJmd(balanceRemaining, 2)}</dd>
        </dl>
        {invoice.fx_note && (
          <p className="mt-4 text-xs text-veridan-warm-gray">
            FX rate (locked from the source quote): <span className="font-mono">{invoice.fx_note}</span>
          </p>
        )}
        {invoice.due_note && <p className="mt-1 text-xs text-veridan-warm-gray">{invoice.due_note}</p>}
      </section>

      {/* Payment history + record payment */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Payment history
        </h2>
        {paymentsForDisplay.length === 0 ? (
          <p className="mb-4 text-sm text-veridan-warm-gray">No payments recorded yet.</p>
        ) : (
          <div className="mb-4 overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
            <table className="w-full min-w-[680px] table-auto border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 text-right">Amount JMD</th>
                  <th className="px-4 py-2">Method</th>
                  <th className="px-4 py-2">Reference</th>
                  <th className="px-4 py-2">Notes</th>
                  <th className="px-4 py-2 text-right">Running balance</th>
                </tr>
              </thead>
              <tbody>
                {paymentsForDisplay.map(({ payment: p, runningBalance }) => (
                  <tr key={p.id} className="border-b border-veridan-warm-gray-light last:border-b-0">
                    <td className="px-4 py-2 text-veridan-ink">{p.paid_at}</td>
                    <td className="px-4 py-2 text-right font-medium text-veridan-ink">{formatJmd(p.amount_jmd, 2)}</td>
                    <td className="px-4 py-2 text-veridan-warm-gray">{p.method ?? "—"}</td>
                    <td className="px-4 py-2 text-veridan-warm-gray">{p.reference ?? "—"}</td>
                    <td className="px-4 py-2 text-veridan-warm-gray">{p.notes ?? "—"}</td>
                    <td className="px-4 py-2 text-right text-veridan-ink">{formatJmd(runningBalance, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canRecordPayment ? (
          <div className="rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-veridan-warm-gray">
              Record a payment
            </h3>
            <RecordPaymentForm invoiceId={invoice.id} />
          </div>
        ) : (
          <InstructiveMessage
            title="Payments cannot be recorded on this invoice"
            body={
              invoice.status === "draft"
                ? "Issue the invoice first."
                : `This invoice is ${INVOICE_STATUS_LABELS[invoice.status].toLowerCase()} — no further payments can be recorded.`
            }
          />
        )}
      </section>

      {/* Workflow actions */}
      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">Actions</h2>
        <InvoiceActionsPanel
          invoiceId={invoice.id}
          status={invoice.status}
          defaultRecipientEmail={defaultRecipientEmail}
          sentPdfUrl={sentPdfUrl}
        />
      </section>
    </div>
  );
}

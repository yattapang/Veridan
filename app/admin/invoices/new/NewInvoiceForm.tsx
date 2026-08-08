"use client";

import { useMemo, useState, useTransition } from "react";
import type { CompanyRow } from "@/lib/supabase/types";
import { computeLineItemTotals } from "@/lib/invoices/lineItems";
import { formatJmd } from "@/lib/quotes/format";
import { createStandaloneInvoice } from "./actions";
import type { ProjectOption } from "./page";

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";
const primaryButtonClass =
  "rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50";

interface DraftLine {
  key: number;
  description: string;
  qty: string;
  unitPriceJmd: string;
}

let nextKey = 1;
function emptyLine(): DraftLine {
  return { key: nextKey++, description: "", qty: "1", unitPriceJmd: "" };
}

export function NewInvoiceForm({ companies, projects }: { companies: CompanyRow[]; projects: ProjectOption[] }) {
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dueNote, setDueNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Only offer projects belonging to the chosen company — mirrors
  // ProjectForm's own company scoping, so a founder can never accidentally
  // link an invoice to another client's project.
  const projectsForCompany = useMemo(
    () => projects.filter((p) => p.company_id === companyId),
    [projects, companyId],
  );

  // Live subtotal preview via the SAME pure totalling function the server
  // action ultimately uses (lib/invoices/lineItems.ts) — what the founder
  // sees here is exactly what will be stored, GCT aside (GCT is applied
  // server-side from the live business parameter, not previewed here since
  // this form has no reliable read of it without another round trip).
  const { lines: validLines, subtotalJmd } = useMemo(
    () =>
      computeLineItemTotals(
        lines.map((l) => ({ description: l.description, qty: Number(l.qty), unitPriceJmd: Number(l.unitPriceJmd) })),
      ),
    [lines],
  );

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function handleSubmit() {
    setError(null);
    if (!companyId) {
      setError("Choose a company.");
      return;
    }
    if (validLines.length === 0) {
      setError("Add at least one line item with a description, quantity, and unit price.");
      return;
    }
    startTransition(async () => {
      const result = await createStandaloneInvoice(
        companyId,
        projectId || null,
        lines.map((l) => ({ description: l.description, qty: Number(l.qty), unitPriceJmd: Number(l.unitPriceJmd) })),
        dueNote || null,
      );
      if (!result.ok) setError(result.error ?? "Something went wrong.");
      // On success createStandaloneInvoice redirects server-side — nothing
      // further to do here.
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="invoice-company">
            Company
          </label>
          <select
            id="invoice-company"
            required
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setProjectId("");
            }}
            className={`${inputClass} mt-1`}
          >
            <option value="" disabled>
              Choose a company…
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="invoice-project">
            Project (optional)
          </label>
          <select
            id="invoice-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={!companyId}
            className={`${inputClass} mt-1`}
          >
            <option value="">No project</option>
            {projectsForCompany.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {companyId && projectsForCompany.length === 0 && (
            <p className="mt-1 text-xs text-veridan-warm-gray">This company has no projects yet.</p>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className={labelClass}>Line items (JMD)</span>
          <button
            type="button"
            onClick={addLine}
            className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
          >
            + Add line
          </button>
        </div>
        <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
          <table className="w-full min-w-[560px] table-auto border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-veridan-warm-gray-light bg-veridan-warm-gray-pale/60 text-[10px] font-semibold uppercase tracking-wide text-veridan-warm-gray">
                <th className="px-3 py-2">Description</th>
                <th className="w-24 px-3 py-2 text-right">Qty</th>
                <th className="w-36 px-3 py-2 text-right">Unit price</th>
                <th className="w-36 px-3 py-2 text-right">Line total</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const qty = Number(line.qty);
                const unitPrice = Number(line.unitPriceJmd);
                const lineTotal =
                  Number.isFinite(qty) && qty > 0 && Number.isFinite(unitPrice) && unitPrice >= 0
                    ? qty * unitPrice
                    : null;
                return (
                  <tr key={line.key} className="border-b border-veridan-warm-gray-light last:border-b-0">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) => updateLine(line.key, { description: e.target.value })}
                        placeholder="Description"
                        className={inputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.qty}
                        onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                        className={`${inputClass} text-right`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitPriceJmd}
                        onChange={(e) => updateLine(line.key, { unitPriceJmd: e.target.value })}
                        placeholder="0.00"
                        className={`${inputClass} text-right`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-veridan-ink">{formatJmd(lineTotal, 2)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length === 1}
                        className="text-xs text-veridan-warm-gray hover:text-red-600 disabled:opacity-30"
                        aria-label="Remove line"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-right text-sm text-veridan-ink">
          Subtotal (JMD): <span className="font-medium">{formatJmd(subtotalJmd, 2)}</span>
        </p>
        <p className="mt-1 text-right text-xs text-veridan-warm-gray">
          GCT is applied on top of this subtotal at invoice creation, per the current GCT business
          parameters — the final amount due shows on the invoice once created.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="invoice-due-note">
          Due note (optional)
        </label>
        <input
          id="invoice-due-note"
          type="text"
          value={dueNote}
          onChange={(e) => setDueNote(e.target.value)}
          placeholder="e.g. Due on receipt."
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={handleSubmit} disabled={pending} className={primaryButtonClass}>
          {pending ? "Creating…" : "Create invoice"}
        </button>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

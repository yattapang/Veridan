"use client";

import { useState, useTransition } from "react";
import type { ContactRow as ContactRowType } from "@/lib/supabase/types";
import { deleteContact } from "../actions";
import { ContactForm } from "./ContactForm";

export function ContactRow({ companyId, contact }: { companyId: string; contact: ContactRowType }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteContact(companyId, contact.id);
      if (!result.ok) {
        setError(result.error);
        setConfirmingDelete(false);
      }
    });
  }

  if (editing) {
    return (
      <li className="border-b border-veridan-warm-gray-light py-4 last:border-b-0">
        <ContactForm companyId={companyId} contact={contact} onSaved={() => setEditing(false)} />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2 text-xs text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
        >
          Cancel
        </button>
      </li>
    );
  }

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ");

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-veridan-warm-gray-light py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-veridan-ink">{fullName}</p>
          {contact.is_primary && (
            <span className="rounded-full bg-veridan-accent-soft/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-veridan-accent">
              Primary
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-veridan-warm-gray">
          {[contact.role_title, contact.email, contact.phone].filter(Boolean).join(" · ") || "No contact details"}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-veridan-accent underline underline-offset-2 hover:text-veridan-accent-soft"
        >
          Edit
        </button>
        {confirmingDelete ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-veridan-warm-gray">Remove?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="font-medium text-red-600 underline underline-offset-2 disabled:opacity-50"
            >
              {pending ? "Removing…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-xs font-medium text-veridan-warm-gray underline underline-offset-2 hover:text-veridan-ink"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

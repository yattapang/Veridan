"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ContactRow } from "@/lib/supabase/types";
import {
  createContact,
  updateContact,
  type ContactFormResult,
} from "../actions";

const initialContactFormResult: ContactFormResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

/**
 * Shared add/edit form for a contact nested under a company (Task 12,
 * §1.11). `contact` present means edit mode; absent means the "add
 * contact" form.
 */
export function ContactForm({
  companyId,
  contact,
  onSaved,
}: {
  companyId: string;
  contact?: ContactRow;
  onSaved?: () => void;
}) {
  const action = contact
    ? updateContact.bind(null, companyId, contact.id)
    : createContact.bind(null, companyId);
  const [state, formAction, pending] = useActionState<ContactFormResult, FormData>(
    action,
    initialContactFormResult
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const idSuffix = contact?.id ?? "new";

  useEffect(() => {
    if (wasPending.current && !pending && state.ok) {
      if (!contact) formRef.current?.reset();
      onSaved?.();
    }
    wasPending.current = pending;
  }, [pending, state.ok, contact, onSaved]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass} htmlFor={`first-name-${idSuffix}`}>
          First name
        </label>
        <input
          id={`first-name-${idSuffix}`}
          type="text"
          name="first_name"
          required
          defaultValue={contact?.first_name}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor={`last-name-${idSuffix}`}>
          Last name
        </label>
        <input
          id={`last-name-${idSuffix}`}
          type="text"
          name="last_name"
          defaultValue={contact?.last_name ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor={`email-${idSuffix}`}>
          Email
        </label>
        <input
          id={`email-${idSuffix}`}
          type="email"
          name="email"
          defaultValue={contact?.email ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor={`phone-${idSuffix}`}>
          Phone
        </label>
        <input
          id={`phone-${idSuffix}`}
          type="text"
          name="phone"
          defaultValue={contact?.phone ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor={`role-${idSuffix}`}>
          Role / title
        </label>
        <input
          id={`role-${idSuffix}`}
          type="text"
          name="role_title"
          defaultValue={contact?.role_title ?? ""}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div className="flex items-end">
        <label className="flex items-center gap-2 text-sm text-veridan-ink">
          <input
            type="checkbox"
            name="is_primary"
            defaultChecked={contact?.is_primary ?? false}
            className="h-4 w-4 rounded border-veridan-warm-gray-light accent-[var(--color-accent)]"
          />
          Primary contact
        </label>
      </div>

      <div className="sm:col-span-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : contact ? "Save changes" : "Add contact"}
        </button>
        {state.ok === false && (
          <p role="alert" className="text-xs text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

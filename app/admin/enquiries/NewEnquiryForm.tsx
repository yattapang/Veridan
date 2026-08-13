"use client";

import { useActionState, useState } from "react";
import { createManualEnquiry, type EnquiryActionResult } from "./actions";
import {
  MANUAL_ENQUIRY_BUILDING_TYPES,
  MANUAL_ENQUIRY_RETROFIT_PATHWAYS,
} from "@/lib/enquiries/manualEntry";

const initialResult: EnquiryActionResult = { ok: true };

const inputClass =
  "w-full rounded-md border border-veridan-warm-gray-light bg-white px-3 py-2 text-sm text-veridan-ink focus:border-veridan-accent focus:outline-none";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-veridan-warm-gray";

const BUILDING_TYPE_LABELS: Record<string, string> = {
  office: "Office",
  hotel: "Hotel",
  school: "School",
  hospital: "Hospital",
  retail: "Retail",
  other: "Other",
};

const RETROFIT_PATHWAY_LABELS: Record<string, string> = {
  owner_direct: "Building owner / FM, direct",
  contractor_instructed: "Contractor, on owner's instruction",
};

/**
 * "New enquiry" form (Task: Admin — enquiries and quotes directly, without
 * a project). Records an enquiry taken by phone, email, or in person —
 * mirrors the two public quote-request forms' fields exactly, with a
 * pathway toggle standing in for "which form would this have been". See
 * ./actions.ts#createManualEnquiry for the insert and
 * lib/enquiries/manualEntry.ts for the shared validation.
 */
export function NewEnquiryForm() {
  const [state, formAction, pending] = useActionState(createManualEnquiry, initialResult);
  const [pathway, setPathway] = useState<"new_construction" | "retrofit">("new_construction");

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="manual-enquiry-pathway">
          Enquiry type
        </label>
        <select
          id="manual-enquiry-pathway"
          name="pathway"
          value={pathway}
          onChange={(e) => setPathway(e.target.value as "new_construction" | "retrofit")}
          className={`${inputClass} mt-1 max-w-xs`}
        >
          <option value="new_construction">New construction</option>
          <option value="retrofit">Retrofit</option>
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="manual-enquiry-contact-name">
          Contact name
        </label>
        <input
          id="manual-enquiry-contact-name"
          type="text"
          name="contact_name"
          required
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="manual-enquiry-company-name">
          Company name{pathway === "retrofit" ? " (optional)" : ""}
        </label>
        <input
          id="manual-enquiry-company-name"
          type="text"
          name="company_name"
          required={pathway === "new_construction"}
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="manual-enquiry-contact-email">
          Contact email
        </label>
        <input
          id="manual-enquiry-contact-email"
          type="email"
          name="contact_email"
          required
          className={`${inputClass} mt-1`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="manual-enquiry-contact-phone">
          Contact phone
        </label>
        <input
          id="manual-enquiry-contact-phone"
          type="tel"
          name="contact_phone"
          placeholder="Optional"
          className={`${inputClass} mt-1`}
        />
      </div>

      {pathway === "new_construction" ? (
        <>
          <div>
            <label className={labelClass} htmlFor="manual-enquiry-project-name">
              Project name
            </label>
            <input
              id="manual-enquiry-project-name"
              type="text"
              name="project_name"
              required
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="manual-enquiry-site-location">
              Site location
            </label>
            <input
              id="manual-enquiry-site-location"
              type="text"
              name="site_location"
              placeholder="Optional"
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="manual-enquiry-delivery-timeframe">
              Delivery timeframe
            </label>
            <input
              id="manual-enquiry-delivery-timeframe"
              type="text"
              name="delivery_timeframe"
              placeholder="Optional"
              className={`${inputClass} mt-1`}
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className={labelClass} htmlFor="manual-enquiry-building-type">
              Building type
            </label>
            <select
              id="manual-enquiry-building-type"
              name="building_type"
              defaultValue=""
              required
              className={`${inputClass} mt-1`}
            >
              <option value="" disabled>
                Choose…
              </option>
              {MANUAL_ENQUIRY_BUILDING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BUILDING_TYPE_LABELS[t] ?? t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="manual-enquiry-retrofit-pathway">
              Who is this from?
            </label>
            <select
              id="manual-enquiry-retrofit-pathway"
              name="retrofit_pathway"
              defaultValue=""
              required
              className={`${inputClass} mt-1`}
            >
              <option value="" disabled>
                Choose…
              </option>
              {MANUAL_ENQUIRY_RETROFIT_PATHWAYS.map((p) => (
                <option key={p} value={p}>
                  {RETROFIT_PATHWAY_LABELS[p] ?? p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2 pb-2">
            <input id="manual-enquiry-urgency" type="checkbox" name="urgency_flag" className="h-4 w-4" />
            <label className="text-sm text-veridan-ink" htmlFor="manual-enquiry-urgency">
              Urgent
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="manual-enquiry-failing-hardware">
              What&apos;s failing
            </label>
            <textarea
              id="manual-enquiry-failing-hardware"
              name="failing_hardware_description"
              rows={2}
              required
              className={`${inputClass} mt-1`}
            />
          </div>
        </>
      )}

      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor="manual-enquiry-notes">
          Notes
        </label>
        <textarea
          id="manual-enquiry-notes"
          name="notes"
          rows={2}
          placeholder="Optional — anything else worth recording from the call."
          className={`${inputClass} mt-1`}
        />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Recording…" : "Record enquiry"}
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

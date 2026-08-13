/**
 * Pure payload-building/validation for a STAFF-ENTERED enquiry (Admin
 * "New enquiry" on the Enquiries tab) — the founder-reported gap that an
 * enquiry taken by phone, email, or in person had nowhere to go. Today the
 * only path into `public.enquiries` is the two public quote-request forms
 * (app/(marketing)/quote-request/new-construction/actions.ts and
 * .../retrofit/actions.ts, both built on lib/enquiries/submit.ts). This
 * module deliberately mirrors those two forms' fields and validation
 * pathway-for-pathway, using the SAME normalize/validate helpers from
 * lib/enquiries/validation.ts, so a manually-entered enquiry produces the
 * identical row shape (and is held to the identical data-quality bar) as a
 * web submission — the admin action that calls this inserts the resulting
 * payload with status 'new', exactly like a fresh web enquiry, so it flows
 * through the same review/convert pipeline unchanged.
 *
 * NOTE ON SOURCE/CHANNEL: `public.enquiries` has no column recording how an
 * enquiry arrived (see supabase/migrations/20260713000001_schema.sql) — this
 * module does not invent one. A manually-recorded enquiry is therefore
 * indistinguishable from a web one once inserted. See the build report for
 * the schema-migration this would need.
 *
 * Kept dependency-free (no Supabase, no "next/headers") so it's unit
 * testable exactly like lib/enquiries/validation.ts.
 */

import {
  isValidEmail,
  normalizeSingleLine,
  normalizeMultiLine,
  MAX_SHORT_TEXT_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_LONG_TEXT_LENGTH,
} from "./validation";
import type { EnquiryInsertPayload } from "./submit";
import type { RetrofitPathway } from "@/lib/supabase/types";

/** Mirrors the public retrofit form's fixed building-type options (app/(marketing)/quote-request/retrofit/actions.ts). */
export const MANUAL_ENQUIRY_BUILDING_TYPES = [
  "office",
  "hotel",
  "school",
  "hospital",
  "retail",
  "other",
] as const;
export type ManualEnquiryBuildingType = (typeof MANUAL_ENQUIRY_BUILDING_TYPES)[number];

/** Mirrors the public retrofit form's fixed pathway options — also the DB check constraint on retrofit_pathway. */
export const MANUAL_ENQUIRY_RETROFIT_PATHWAYS: RetrofitPathway[] = [
  "owner_direct",
  "contractor_instructed",
];

export interface ManualEnquiryFields {
  /** "new_construction" | "retrofit" */
  pathway: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  // new_construction only
  projectName: string;
  siteLocation: string;
  deliveryTimeframe: string;
  // retrofit only
  buildingType: string;
  failingHardwareDescription: string;
  urgencyFlag: boolean;
  retrofitPathway: string;
  // shared free text
  notes: string;
}

export type ManualEnquiryResult =
  | { ok: true; payload: EnquiryInsertPayload; error?: undefined }
  | { ok: false; error: string; payload?: undefined };

/**
 * Builds an `EnquiryInsertPayload` (the same type lib/enquiries/submit.ts's
 * `submitEnquiry` accepts) from raw staff-entered fields, or an error if a
 * pathway-required field is missing/invalid. The caller (the "New enquiry"
 * server action) is responsible for the actual insert — this only shapes
 * and validates the data.
 */
export function buildManualEnquiryPayload(fields: ManualEnquiryFields): ManualEnquiryResult {
  const contactName = normalizeSingleLine(fields.contactName, MAX_SHORT_TEXT_LENGTH);
  const contactEmail = normalizeSingleLine(fields.contactEmail, MAX_EMAIL_LENGTH);
  const contactPhone = normalizeSingleLine(fields.contactPhone, MAX_PHONE_LENGTH);
  const companyName = normalizeSingleLine(fields.companyName, MAX_SHORT_TEXT_LENGTH);
  const notes = normalizeMultiLine(fields.notes, MAX_LONG_TEXT_LENGTH);

  if (!contactName) return { ok: false, error: "Contact name is required." };
  if (!contactEmail || !isValidEmail(contactEmail)) {
    return { ok: false, error: "A valid contact email is required." };
  }

  if (fields.pathway === "retrofit") {
    const buildingType = normalizeSingleLine(fields.buildingType, MAX_SHORT_TEXT_LENGTH);
    const failingHardwareDescription = normalizeMultiLine(
      fields.failingHardwareDescription,
      MAX_LONG_TEXT_LENGTH
    );
    const retrofitPathway = normalizeSingleLine(fields.retrofitPathway, MAX_SHORT_TEXT_LENGTH);

    if (!(MANUAL_ENQUIRY_BUILDING_TYPES as readonly string[]).includes(buildingType)) {
      return { ok: false, error: "Choose a valid building type." };
    }
    if (!failingHardwareDescription) {
      return { ok: false, error: "Describe what's failing." };
    }
    if (!(MANUAL_ENQUIRY_RETROFIT_PATHWAYS as readonly string[]).includes(retrofitPathway)) {
      return { ok: false, error: "Choose who this enquiry is from." };
    }

    return {
      ok: true,
      payload: {
        pathway: "retrofit",
        company_name: companyName || null,
        contact_name: contactName,
        contact_email: contactEmail,
        contact_phone: contactPhone || null,
        project_details: notes || null,
        delivery_timeframe: null,
        building_type: buildingType,
        failing_hardware_description: failingHardwareDescription,
        urgency_flag: fields.urgencyFlag,
        retrofit_pathway: retrofitPathway as RetrofitPathway,
        line_items_structured: null,
      },
    };
  }

  if (fields.pathway !== "new_construction") {
    return { ok: false, error: "Choose a valid pathway." };
  }

  const projectName = normalizeSingleLine(fields.projectName, MAX_SHORT_TEXT_LENGTH);
  const siteLocation = normalizeSingleLine(fields.siteLocation, MAX_SHORT_TEXT_LENGTH);
  const deliveryTimeframe = normalizeSingleLine(fields.deliveryTimeframe, MAX_SHORT_TEXT_LENGTH);

  if (!companyName) return { ok: false, error: "Company name is required." };
  if (!projectName) return { ok: false, error: "Project name is required." };

  // Same "fold project name/site/notes into project_details" shape the
  // public new-construction form uses, so the stored text reads identically
  // regardless of which path an enquiry came in through.
  const projectDetailsParts = [
    `Project name: ${projectName}`,
    siteLocation ? `Site location: ${siteLocation}` : null,
    notes ? `Notes: ${notes}` : null,
  ].filter((p): p is string => p !== null);

  return {
    ok: true,
    payload: {
      pathway: "new_construction",
      company_name: companyName,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone || null,
      project_details: projectDetailsParts.join("\n"),
      delivery_timeframe: deliveryTimeframe || null,
      building_type: null,
      failing_hardware_description: null,
      urgency_flag: false,
      retrofit_pathway: null,
      line_items_structured: null,
    },
  };
}

"use server";

import { redirect } from "next/navigation";
import {
  submitEnquiry,
  readHoneypotTripped,
  type EnquiryInsertPayload,
} from "@/lib/enquiries/submit";
import {
  isValidEmail,
  normalizeSingleLine,
  normalizeMultiLine,
  MAX_SHORT_TEXT_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_LONG_TEXT_LENGTH,
} from "@/lib/enquiries/validation";

export type SubmitState = { ok: true } | { ok: false; error: string };

const BUILDING_TYPES = new Set([
  "office",
  "hotel",
  "school",
  "hospital",
  "retail",
  "other",
]);

const RETROFIT_PATHWAYS = new Set(["owner_direct", "contractor_instructed"]);

export async function submitRetrofitEnquiry(
  _prevState: SubmitState,
  formData: FormData
): Promise<SubmitState> {
  const honeypotTripped = readHoneypotTripped(formData);

  const companyName = normalizeSingleLine(formData.get("company_name"), MAX_SHORT_TEXT_LENGTH);
  const contactName = normalizeSingleLine(formData.get("contact_name"), MAX_SHORT_TEXT_LENGTH);
  const contactEmail = normalizeSingleLine(formData.get("contact_email"), MAX_EMAIL_LENGTH);
  const contactPhone = normalizeSingleLine(formData.get("contact_phone"), MAX_PHONE_LENGTH);
  // building_type is validated against a fixed enum below, so a short cap
  // here is just defense-in-depth, not the primary check.
  const buildingType = normalizeSingleLine(formData.get("building_type"), MAX_SHORT_TEXT_LENGTH);
  const failingDescription = normalizeMultiLine(
    formData.get("failing_hardware_description"),
    MAX_LONG_TEXT_LENGTH
  );
  const urgencyFlag = formData.get("urgency_flag") === "on";
  const retrofitPathway = normalizeSingleLine(
    formData.get("retrofit_pathway"),
    MAX_SHORT_TEXT_LENGTH
  );
  const notes = normalizeMultiLine(formData.get("notes"), MAX_LONG_TEXT_LENGTH);

  if (!honeypotTripped) {
    if (!contactName) return { ok: false, error: "Contact name is required." };
    if (!contactEmail || !isValidEmail(contactEmail)) {
      return { ok: false, error: "A valid contact email is required." };
    }
    if (!buildingType || !BUILDING_TYPES.has(buildingType)) {
      return { ok: false, error: "Please select a building type." };
    }
    if (!failingDescription) {
      return { ok: false, error: "Please describe what's failing." };
    }
    if (!retrofitPathway || !RETROFIT_PATHWAYS.has(retrofitPathway)) {
      return { ok: false, error: "Please select which best describes you." };
    }
  }

  const payload: EnquiryInsertPayload = {
    pathway: "retrofit",
    company_name: companyName || null,
    contact_name: contactName,
    contact_email: contactEmail,
    contact_phone: contactPhone || null,
    project_details: notes || null,
    delivery_timeframe: null,
    building_type: buildingType || null,
    failing_hardware_description: failingDescription || null,
    urgency_flag: urgencyFlag,
    retrofit_pathway: (retrofitPathway || null) as EnquiryInsertPayload["retrofit_pathway"],
    line_items_structured: null,
  };

  const summaryLines = [
    { label: "Building type", value: buildingType || "(not provided)" },
    { label: "What's failing", value: failingDescription || "(not provided)" },
    { label: "Urgent", value: urgencyFlag ? "Yes" : "No" },
    {
      label: "Pathway",
      value:
        retrofitPathway === "owner_direct"
          ? "Building owner / FM direct"
          : retrofitPathway === "contractor_instructed"
            ? "Contractor, on owner's instruction"
            : "(not provided)",
    },
    ...(notes ? [{ label: "Notes", value: notes }] : []),
  ];

  const result = await submitEnquiry(payload, null, honeypotTripped, { summaryLines });

  if (!result.ok) {
    return result;
  }

  redirect("/quote-request/thank-you?pathway=retrofit");
}

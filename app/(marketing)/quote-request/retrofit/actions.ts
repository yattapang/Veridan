"use server";

import { redirect } from "next/navigation";
import {
  submitEnquiry,
  readHoneypotTripped,
  type EnquiryInsertPayload,
} from "@/lib/enquiries/submit";

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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function submitRetrofitEnquiry(
  _prevState: SubmitState,
  formData: FormData
): Promise<SubmitState> {
  const honeypotTripped = readHoneypotTripped(formData);

  const companyName = String(formData.get("company_name") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  const contactPhone = String(formData.get("contact_phone") ?? "").trim();
  const buildingType = String(formData.get("building_type") ?? "").trim();
  const failingDescription = String(formData.get("failing_hardware_description") ?? "").trim();
  const urgencyFlag = formData.get("urgency_flag") === "on";
  const retrofitPathway = String(formData.get("retrofit_pathway") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

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

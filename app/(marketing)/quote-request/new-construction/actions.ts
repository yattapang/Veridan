"use server";

import { redirect } from "next/navigation";
import {
  submitEnquiry,
  readHoneypotTripped,
  type EnquiryInsertPayload,
} from "@/lib/enquiries/submit";
import {
  isValidEmail,
  isReasonableLineItemCount,
  normalizeSingleLine,
  normalizeMultiLine,
  MAX_SHORT_TEXT_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_LONG_TEXT_LENGTH,
  MAX_LINE_ITEM_FIELD_LENGTH,
  MAX_LINE_ITEMS,
} from "@/lib/enquiries/validation";

export type SubmitState = { ok: true } | { ok: false; error: string };

interface ParsedLineItem {
  description: string;
  qty: string;
  notes: string;
}

function parseStructuredLineItems(formData: FormData): ParsedLineItem[] {
  const descriptions = formData.getAll("line_item_description");
  const qtys = formData.getAll("line_item_qty");
  const notes = formData.getAll("line_item_notes");

  const rows: ParsedLineItem[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = normalizeSingleLine(descriptions[i], MAX_LINE_ITEM_FIELD_LENGTH);
    const qty = normalizeSingleLine(qtys[i], MAX_LINE_ITEM_FIELD_LENGTH);
    const note = normalizeSingleLine(notes[i], MAX_LINE_ITEM_FIELD_LENGTH);
    if (!description && !qty && !note) continue; // skip fully-blank rows
    rows.push({ description, qty, notes: note });
  }
  return rows;
}

export async function submitNewConstructionEnquiry(
  _prevState: SubmitState,
  formData: FormData
): Promise<SubmitState> {
  const honeypotTripped = readHoneypotTripped(formData);

  const companyName = normalizeSingleLine(formData.get("company_name"), MAX_SHORT_TEXT_LENGTH);
  const contactName = normalizeSingleLine(formData.get("contact_name"), MAX_SHORT_TEXT_LENGTH);
  const contactEmail = normalizeSingleLine(formData.get("contact_email"), MAX_EMAIL_LENGTH);
  const contactPhone = normalizeSingleLine(formData.get("contact_phone"), MAX_PHONE_LENGTH);
  const projectName = normalizeSingleLine(formData.get("project_name"), MAX_SHORT_TEXT_LENGTH);
  const siteLocation = normalizeSingleLine(formData.get("site_location"), MAX_SHORT_TEXT_LENGTH);
  const deliveryTimeframe = normalizeSingleLine(
    formData.get("delivery_timeframe"),
    MAX_SHORT_TEXT_LENGTH
  );
  const notes = normalizeMultiLine(formData.get("notes"), MAX_LONG_TEXT_LENGTH);
  const scheduleMode = String(formData.get("schedule_mode") ?? "file");

  if (!honeypotTripped) {
    if (!companyName) return { ok: false, error: "Company name is required." };
    if (!contactName) return { ok: false, error: "Contact name is required." };
    if (!contactEmail || !isValidEmail(contactEmail)) {
      return { ok: false, error: "A valid contact email is required." };
    }
    if (!projectName) return { ok: false, error: "Project name is required." };
  }

  const file = formData.get("hardware_schedule");
  const uploadedFile = file instanceof File && file.size > 0 ? file : null;

  let lineItems: ParsedLineItem[] = [];
  if (scheduleMode === "structured") {
    lineItems = parseStructuredLineItems(formData);
    if (!honeypotTripped && lineItems.length === 0 && !uploadedFile) {
      return {
        ok: false,
        error:
          "Add at least one hardware line item, or switch to file upload and attach a schedule.",
      };
    }
    if (!honeypotTripped && !isReasonableLineItemCount(lineItems.length)) {
      return {
        ok: false,
        error: `Too many line items in one submission (max ${MAX_LINE_ITEMS}). Please split this into multiple requests or upload a file instead.`,
      };
    }
    // Honeypot-tripped submissions are never rejected with a visible error
    // (see submitEnquiry's honeypot handling) — just clamp so an
    // absurdly padded bot payload can't bloat the row we insert for review.
    if (honeypotTripped && lineItems.length > MAX_LINE_ITEMS) {
      lineItems = lineItems.slice(0, MAX_LINE_ITEMS);
    }
  } else if (!honeypotTripped && !uploadedFile) {
    return {
      ok: false,
      error:
        "Please attach a hardware schedule file, or switch to structured line-item entry.",
    };
  }

  const projectDetailsParts = [
    `Project name: ${projectName || "(not provided)"}`,
    siteLocation ? `Site location: ${siteLocation}` : null,
    notes ? `Notes: ${notes}` : null,
  ].filter((p): p is string => p !== null);

  const payload: EnquiryInsertPayload = {
    pathway: "new_construction",
    company_name: companyName || null,
    contact_name: contactName,
    contact_email: contactEmail,
    contact_phone: contactPhone || null,
    project_details: projectDetailsParts.join("\n"),
    delivery_timeframe: deliveryTimeframe || null,
    building_type: null,
    failing_hardware_description: null,
    urgency_flag: false,
    retrofit_pathway: null,
    line_items_structured:
      scheduleMode === "structured" && lineItems.length > 0 ? lineItems : null,
  };

  const summaryLines = [
    { label: "Project name", value: projectName || "(not provided)" },
    { label: "Site location", value: siteLocation || "(not provided)" },
    { label: "Delivery timeframe", value: deliveryTimeframe || "(not provided)" },
    {
      label: "Hardware schedule",
      value:
        scheduleMode === "structured"
          ? `${lineItems.length} structured line item(s)`
          : uploadedFile
            ? `File uploaded: ${uploadedFile.name}`
            : "(not provided)",
    },
    ...(notes ? [{ label: "Notes", value: notes }] : []),
  ];

  const result = await submitEnquiry(payload, uploadedFile, honeypotTripped, {
    summaryLines,
  });

  if (!result.ok) {
    return result;
  }

  redirect("/quote-request/thank-you?pathway=new-construction");
}

import { describe, expect, it } from "vitest";
import { buildManualEnquiryPayload, type ManualEnquiryFields } from "./manualEntry";

const baseFields: ManualEnquiryFields = {
  pathway: "new_construction",
  companyName: "Acme Contractors",
  contactName: "Jane Doe",
  contactEmail: "jane@acme.com",
  contactPhone: "876-555-1234",
  projectName: "Acme HQ Fitout",
  siteLocation: "Kingston",
  deliveryTimeframe: "Q4 2026",
  buildingType: "",
  failingHardwareDescription: "",
  urgencyFlag: false,
  retrofitPathway: "",
  notes: "Called in by the founder.",
};

describe("buildManualEnquiryPayload — shared validation", () => {
  it("rejects a missing contact name", () => {
    const result = buildManualEnquiryPayload({ ...baseFields, contactName: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing or invalid contact email", () => {
    expect(buildManualEnquiryPayload({ ...baseFields, contactEmail: "" }).ok).toBe(false);
    expect(buildManualEnquiryPayload({ ...baseFields, contactEmail: "not-an-email" }).ok).toBe(false);
  });

  it("trims and normalizes contact fields", () => {
    const result = buildManualEnquiryPayload({
      ...baseFields,
      contactName: "  Jane   Doe  ",
      contactPhone: "  876-555-1234  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.contact_name).toBe("Jane Doe");
      expect(result.payload.contact_phone).toBe("876-555-1234");
    }
  });

  it("rejects an unrecognized pathway", () => {
    const result = buildManualEnquiryPayload({ ...baseFields, pathway: "carrier_pigeon" });
    expect(result.ok).toBe(false);
  });
});

describe("buildManualEnquiryPayload — new_construction pathway", () => {
  it("requires a company name and project name", () => {
    expect(buildManualEnquiryPayload({ ...baseFields, companyName: "" }).ok).toBe(false);
    expect(buildManualEnquiryPayload({ ...baseFields, projectName: "" }).ok).toBe(false);
  });

  it("builds a payload matching the public new-construction form's shape", () => {
    const result = buildManualEnquiryPayload(baseFields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      pathway: "new_construction",
      company_name: "Acme Contractors",
      contact_name: "Jane Doe",
      contact_email: "jane@acme.com",
      building_type: null,
      failing_hardware_description: null,
      urgency_flag: false,
      retrofit_pathway: null,
      line_items_structured: null,
    });
    expect(result.payload.project_details).toBe(
      "Project name: Acme HQ Fitout\nSite location: Kingston\nNotes: Called in by the founder."
    );
  });

  it("omits blank optional lines from project_details", () => {
    const result = buildManualEnquiryPayload({
      ...baseFields,
      siteLocation: "",
      notes: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.project_details).toBe("Project name: Acme HQ Fitout");
    }
  });
});

describe("buildManualEnquiryPayload — retrofit pathway", () => {
  const retrofitFields: ManualEnquiryFields = {
    ...baseFields,
    pathway: "retrofit",
    projectName: "",
    buildingType: "office",
    failingHardwareDescription: "Closer on the main entrance is failing.",
    urgencyFlag: true,
    retrofitPathway: "owner_direct",
  };

  it("requires a valid building type", () => {
    expect(buildManualEnquiryPayload({ ...retrofitFields, buildingType: "" }).ok).toBe(false);
    expect(buildManualEnquiryPayload({ ...retrofitFields, buildingType: "spaceship" }).ok).toBe(false);
  });

  it("requires a failing-hardware description", () => {
    expect(
      buildManualEnquiryPayload({ ...retrofitFields, failingHardwareDescription: "" }).ok
    ).toBe(false);
  });

  it("requires a valid retrofit pathway", () => {
    expect(buildManualEnquiryPayload({ ...retrofitFields, retrofitPathway: "" }).ok).toBe(false);
    expect(
      buildManualEnquiryPayload({ ...retrofitFields, retrofitPathway: "carrier_pigeon" }).ok
    ).toBe(false);
  });

  it("does not require a company name (retrofit form doesn't either)", () => {
    const result = buildManualEnquiryPayload({ ...retrofitFields, companyName: "" });
    expect(result.ok).toBe(true);
  });

  it("builds a payload matching the public retrofit form's shape", () => {
    const result = buildManualEnquiryPayload(retrofitFields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      pathway: "retrofit",
      building_type: "office",
      failing_hardware_description: "Closer on the main entrance is failing.",
      urgency_flag: true,
      retrofit_pathway: "owner_direct",
      project_details: "Called in by the founder.",
      delivery_timeframe: null,
      line_items_structured: null,
    });
  });

  it("stores null project_details when notes are blank", () => {
    const result = buildManualEnquiryPayload({ ...retrofitFields, notes: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.project_details).toBeNull();
    }
  });
});

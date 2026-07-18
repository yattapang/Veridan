/**
 * Minimal hand-written row types for the tables the admin UI touches so
 * far (Tasks 5-6). Not a generated `supabase gen types` file — this repo
 * has no live Supabase project to generate against yet (see AGENTS notes
 * in the build plan). Extend as later tasks add more admin surfaces.
 */

import type { PipelineStage } from "@/lib/pipeline";

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
}

/** The typed jsonb envelope stored in business_parameters.value (§1.14). */
export interface ParameterValueEnvelope {
  type: "numeric" | "text" | "boolean" | "table";
  value: unknown;
}

export type ParameterValueType = "numeric" | "percent" | "text" | "boolean" | "table";

export interface BusinessParameterRow {
  id: string;
  key: string;
  value: ParameterValueEnvelope;
  value_type: ParameterValueType;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

/** ISO currency codes accepted throughout the schema (§1.1, §1.2). */
export type CurrencyCode = "USD" | "CAD" | "GBP" | "EUR" | "JMD";

export const CURRENCY_CODES: CurrencyCode[] = ["USD", "CAD", "GBP", "EUR", "JMD"];

/** §1.1 Suppliers */
export interface SupplierRow {
  id: string;
  name: string;
  country: string | null;
  origin_region: string | null;
  default_currency: CurrencyCode;
  default_lead_time_text: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** §1.2 Products (Hardware Library) */
export type ProductCategory =
  | "locksets"
  | "closers"
  | "hinges"
  | "exit_devices"
  | "access_control"
  | "ironmongery"
  | "signage"
  | "frames"
  | "other";

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  "locksets",
  "closers",
  "hinges",
  "exit_devices",
  "access_control",
  "ironmongery",
  "signage",
  "frames",
  "other",
];

/**
 * §1.4 Phase 2A item_groups grade — ANSI/BHMA valid-value set (§8 FOUNDER
 * RESOLUTIONS Q2 RESOLVED). Not an internal Veridan quality label.
 */
export type GradeValue = "Grade 1" | "Grade 2" | "Grade 3";
export const GRADE_VALUES: GradeValue[] = ["Grade 1", "Grade 2", "Grade 3"];

export interface ProductRow {
  id: string;
  generic_category: ProductCategory;
  description: string;
  catalogue_ref: string | null;
  specified_finish: string | null;
  supplied_finish: string | null;
  manufacturer: string | null;
  product_ref: string | null;
  supplier_id: string | null;
  unit: string;
  unit_cost: number;
  cost_currency: CurrencyCode;
  source: "manual" | "price_file_extraction";
  active: boolean;
  /** Phase 2A additive column (Task 29) — see 20260717000002_item_groups_and_product_variants.sql. */
  item_group_id: string | null;
  /** Phase 2A additive column (Task 29). */
  finish_code: string | null;
  /** Phase 2A additive column (Task 29). */
  design_series: string | null;
  created_at: string;
  updated_at: string;
}

/** Product row joined with its supplier's name, for list display. */
export interface ProductWithSupplier extends ProductRow {
  suppliers: { id: string; name: string } | null;
  /**
   * Present only when the query explicitly embeds item_groups (Phase 2A
   * filter bar / comparison view / picker). Optional so existing queries
   * that don't embed it (e.g. plain `suppliers(id,name)` selects) keep
   * typechecking without a query change.
   */
  item_groups?: { id: string; family_name: string; grade: GradeValue | null } | null;
}

/** §1.4 item_groups (Phase 2A, Task 28) */
export interface ItemGroupRow {
  id: string;
  family_name: string;
  grade: GradeValue | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** item_groups row joined with an aggregate product count, for the CRUD list. */
export interface ItemGroupWithProductCount extends ItemGroupRow {
  products: { count: number }[] | null;
}

/** item_group_merges audit log row (Task 30). */
export interface ItemGroupMergeRow {
  id: string;
  surviving_group_id: string;
  losing_group_family_name: string;
  losing_group_grade: GradeValue | null;
  product_count: number;
  reason: string | null;
  merged_by: string | null;
  merged_at: string;
}

/** §1.10 Companies */
export type CompanyType =
  | "architect"
  | "contractor"
  | "owner"
  | "fm"
  | "supplier_contact";

export const COMPANY_TYPES: CompanyType[] = [
  "architect",
  "contractor",
  "owner",
  "fm",
  "supplier_contact",
];

export type CompanyStatus = "new" | "established";

export interface CompanyRow {
  id: string;
  name: string;
  type: CompanyType;
  status: CompanyStatus;
  completed_order_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** §1.11 Contacts */
export interface ContactRow {
  id: string;
  company_id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role_title: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

/** §1.12 Enquiries (portal intake) */
export type EnquiryPathway = "new_construction" | "retrofit";
export const ENQUIRY_PATHWAYS: EnquiryPathway[] = ["new_construction", "retrofit"];

export type EnquiryStatus = "new" | "reviewing" | "converted" | "discarded";
export const ENQUIRY_STATUSES: EnquiryStatus[] = ["new", "reviewing", "converted", "discarded"];

export type RetrofitPathway = "owner_direct" | "contractor_instructed";

export interface EnquiryRow {
  id: string;
  pathway: EnquiryPathway;
  company_name: string | null;
  matched_company_id: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  project_details: string | null;
  delivery_timeframe: string | null;
  building_type: string | null;
  failing_hardware_description: string | null;
  urgency_flag: boolean;
  retrofit_pathway: RetrofitPathway | null;
  uploaded_file_paths: string[] | null;
  line_items_structured: unknown | null;
  honeypot_tripped: boolean;
  status: EnquiryStatus;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

/** §1.5 Projects */
export type ProjectType = "new_construction" | "retrofit";
export const PROJECT_TYPES: ProjectType[] = ["new_construction", "retrofit"];

export type ProjectStatus = "active" | "closed" | "archived";
export const PROJECT_STATUSES: ProjectStatus[] = ["active", "closed", "archived"];

export interface ProjectRow {
  id: string;
  company_id: string;
  primary_contact_id: string | null;
  architect_company_id: string | null;
  name: string;
  site_address: string | null;
  project_type: ProjectType;
  status: ProjectStatus;
  enquiry_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Project row joined with related company names, for list/detail display. */
export interface ProjectWithCompany extends ProjectRow {
  companies: { id: string; name: string } | null;
}

/** §1.3 Hardware Sets */
export interface HardwareSetRow {
  id: string;
  project_id: string | null;
  code: string;
  name: string | null;
  cloned_from_set_id: string | null;
  created_at: string;
  updated_at: string;
}

/** §1.6 Doors (Door Register) */
export interface DoorRow {
  id: string;
  project_id: string;
  floor: string | null;
  door_number: string;
  /** Derived-but-stored (§7.1 item 5) — see lib/doors.ts:deriveDoorType. */
  door_type: string | null;
  location_description: string | null;
  hardware_set_id: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

/** Door row joined with its assigned hardware set, for the register grid. */
export interface DoorWithHardwareSet extends DoorRow {
  hardware_sets: { id: string; code: string; name: string | null } | null;
}

/**
 * §1.4 Hardware Set Line Items. `notes` is an additive column beyond the
 * build plan's §1.4 table — see
 * supabase/migrations/20260715000001_hardware_set_line_item_notes.sql.
 */
export interface HardwareSetLineItemRow {
  id: string;
  hardware_set_id: string;
  product_id: string;
  supplier_id: string;
  qty: number;
  unit_cost_override: number | null;
  cost_currency_override: CurrencyCode | null;
  sort_order: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Line item joined with its product + supplier for display/costing. */
export interface HardwareSetLineItemWithDetails extends HardwareSetLineItemRow {
  products: {
    id: string;
    description: string;
    manufacturer: string | null;
    product_ref: string | null;
    catalogue_ref: string | null;
    unit: string;
    unit_cost: number;
    cost_currency: CurrencyCode;
  } | null;
  suppliers: { id: string; name: string; default_currency: CurrencyCode } | null;
}

// ---------------------------------------------------------------------------
// §1.7 / §1.8 / §1.9 — Quotes, Quote Origins, Quote Line Items (Task 16)
// ---------------------------------------------------------------------------

export type QuoteStatus =
  | "draft"
  | "approved"
  | "sent"
  | "viewed"
  | "accepted"
  | "declined"
  | "expired";

export type QuoteMode = "door_register" | "line_item";

/** §1.7 fx_snapshot jsonb payload (values locked at quote_date). */
export interface FxSnapshotStored {
  bank_sell_rate: number;
  fx_buffer_pct: number;
  effective_rate: number;
  supplier_rates: Partial<Record<CurrencyCode, number>>;
  source: string;
  as_of: string;
}

/**
 * §1.7 parameters_snapshot jsonb payload — a full, typed copy of every
 * business parameter that the landed-cost engine or the quote document reads,
 * frozen at quote_date so later parameter edits never rewrite this quote.
 */
export interface ParametersSnapshotStored {
  duty_gct_pct: number;
  marine_insurance_pct: number;
  brokerage_first_pallet_usd: number;
  brokerage_addl_pallet_usd: number;
  port_handling_usd: number;
  freight_insurance_fallback_usd: number;
  procurement_handling_fee_usd: number;
  contingency_pct: number;
  margin_tiers: number[];
  margin_floor_pct: number;
  min_order_value_usd: number;
  deposit_standard_pct: number;
  quote_validity_days: number;
  default_finish: string;
  gct_enabled: boolean;
  gct_rate_pct: number;
  lead_times: Record<string, string>;
  company_details: Record<string, string>;
}

/** §1.7 Quotes */
export interface QuoteRow {
  id: string;
  project_id: string;
  quote_ref: string;
  revision_number: number;
  parent_quote_id: string | null;
  status: QuoteStatus;
  quote_mode: QuoteMode;
  quote_date: string;
  validity_days: number;
  architect_company_id: string | null;
  deposit_pct: number;
  margin_pct: number;
  margin_override_reason: string | null;
  parameters_snapshot: ParametersSnapshotStored;
  fx_snapshot: FxSnapshotStored;
  total_landed_usd: number | null;
  total_client_jmd: number | null;
  total_client_usd: number | null;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  pdf_storage_path: string | null;
  created_by: string | null;
  /** Task 19 additive column — see supabase/migrations/20260716000002_quote_workflow.sql. */
  approved_by: string | null;
  /** Task 19 additive column. */
  approved_at: string | null;
  /** Task 19 additive column — recipient address the quote was actually emailed to. */
  sent_to: string | null;
  /** Task 47 additive column — see 20260718000002_invoicing.sql for placement rationale. */
  customs_cleared_at: string | null;
  /** Task 47 additive column. */
  customs_cleared_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Quote joined with project + client company, for the list/detail header. */
export interface QuoteWithProject extends QuoteRow {
  projects: {
    id: string;
    name: string;
    companies: { id: string; name: string } | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Invoicing (Phase 2C, Tasks 44-47) — see 20260718000002_invoicing.sql
// ---------------------------------------------------------------------------

export type InvoiceType = "deposit" | "balance";
export const INVOICE_TYPES: InvoiceType[] = ["deposit", "balance"];

export type InvoiceStatus = "draft" | "issued" | "sent" | "paid" | "partially_paid" | "void";
export const INVOICE_STATUSES: InvoiceStatus[] = [
  "draft",
  "issued",
  "sent",
  "paid",
  "partially_paid",
  "void",
];

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  quote_id: string;
  project_id: string | null;
  company_id: string | null;
  invoice_type: InvoiceType;
  status: InvoiceStatus;
  subtotal_jmd: number | null;
  gct_amount_jmd: number;
  amount_jmd: number;
  amount_usd: number | null;
  fx_note: string | null;
  due_note: string | null;
  issued_at: string | null;
  sent_at: string | null;
  sent_to: string | null;
  pdf_storage_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Invoice joined with quote/project/company, for the list/detail views. */
export interface InvoiceWithRefs extends InvoiceRow {
  quotes: { id: string; quote_ref: string } | null;
  projects: { id: string; name: string } | null;
  companies: { id: string; name: string } | null;
}

export interface InvoicePaymentRow {
  id: string;
  invoice_id: string;
  amount_jmd: number;
  paid_at: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
}

/** §1.8 Quote Origins (shipment cost pools per quote) */
export interface QuoteOriginRow {
  id: string;
  quote_id: string;
  origin_label: string;
  supplier_invoice_total: number | null;
  freight_export_fees_usd: number;
  ocean_freight_usd: number | null;
  marine_insurance_usd: number | null;
  port_handling_usd: number | null;
  brokerage_usd: number | null;
  pallet_count: number;
  duty_gct_pct: number | null;
  cif_basis_usd: number | null;
  total_shipment_cost_usd: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * §1.9 Quote Line Items. `product_id` and `supplier_id` are additive beyond
 * the build plan's §1.9 table — see
 * supabase/migrations/20260716000001_line_item_quote_lines.sql (Task 17).
 * `product_id` is nullable so line_item-mode quotes can carry free-text
 * ad-hoc lines (no Hardware Library entry); `supplier_id` is populated for
 * every line_item-mode line (library-picked or ad-hoc) and drives origin-pool
 * regrouping. Both are null for door_register-mode lines (product_id is
 * always set there; origin is fixed at materialization time, not per-line).
 */
export interface QuoteLineItemRow {
  id: string;
  quote_id: string;
  door_id: string | null;
  hardware_set_id: string | null;
  product_id: string | null;
  supplier_id: string | null;
  quote_origin_id: string;
  description_override: string | null;
  qty: number;
  unit_cost: number;
  cost_currency: CurrencyCode;
  unit_cost_usd: number;
  line_value_usd: number;
  allocated_shipment_cost_usd: number | null;
  landed_cost_usd: number;
  margin_pct_override: number | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

/** Line item joined with product/door/hardware-set/supplier for the builder grid. */
export interface QuoteLineItemWithDetails extends QuoteLineItemRow {
  products: {
    id: string;
    description: string;
    manufacturer: string | null;
    product_ref: string | null;
    unit: string;
  } | null;
  doors: { id: string; door_number: string; floor: string | null } | null;
  hardware_sets: { id: string; code: string; name: string | null } | null;
  suppliers: { id: string; name: string } | null;
}

/** §1.16 Override Log */
export type OverrideType =
  | "margin_below_tier"
  | "margin_below_floor"
  | "price_below_landed_cost";

export interface OverrideLogRow {
  id: string;
  quote_id: string;
  override_type: OverrideType;
  requested_margin_pct: number | null;
  landed_cost_usd: number | null;
  quoted_price_usd: number | null;
  reason: string;
  overridden_by: string | null;
  created_at: string;
}

/** Override log joined with the user who created it, for display. */
export interface OverrideLogWithUser extends OverrideLogRow {
  users: { id: string; email: string; display_name: string | null } | null;
}

/** Override log joined with the user AND the quote ref, for /admin/overrides (Task 22). */
export interface OverrideLogWithDetails extends OverrideLogWithUser {
  quotes: { id: string; quote_ref: string } | null;
}

// ---------------------------------------------------------------------------
// §1.13 Pipeline view (Task 20) — read-only, mirrors `pipeline_view`
// (supabase/migrations/20260713000001_schema.sql, amended by
// 20260717000001_pipeline_view_kpi_columns.sql). `stage` is computed in SQL
// but its logic is duplicated as a pure function in lib/pipeline.ts
// (deriveStage) so the mapping rule itself is unit-testable.
// ---------------------------------------------------------------------------
export interface PipelineViewRow {
  enquiry_id: string;
  project_id: string | null;
  quote_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  pathway: EnquiryPathway;
  enquiry_status: EnquiryStatus;
  enquiry_created_at: string;
  quote_ref: string | null;
  quote_status: QuoteStatus | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  total_client_jmd: number | null;
  total_client_usd: number | null;
  total_landed_usd: number | null;
  project_status: ProjectStatus | null;
  stage: PipelineStage;
}

// ---------------------------------------------------------------------------
// §2.2 / §2.4 Phase 2B price-file ingestion (Task 36). Shapes match the
// COMBINED schema: base tables from
// supabase/migrations/20260713000001_schema.sql (§1.18) PLUS the delta in
// supabase/migrations/20260718000001_price_ingestion.sql — that combined
// shape is authoritative, not the base migration alone.
// ---------------------------------------------------------------------------

/** price_file_uploads.extraction_status — post-delta lifecycle (Task 35). */
export type ExtractionStatus = "pending" | "extracting" | "review" | "completed" | "failed";
export const EXTRACTION_STATUSES: ExtractionStatus[] = [
  "pending",
  "extracting",
  "review",
  "completed",
  "failed",
];

/** §1.18 price_file_uploads, upgraded by the Task 35 delta migration. */
export interface PriceFileUploadRow {
  id: string;
  supplier_id: string | null;
  file_storage_path: string;
  original_filename: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  extraction_status: ExtractionStatus;
  detected_supplier_confidence: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** Upload row joined with supplier + uploader for list/detail display. */
export interface PriceFileUploadWithDetails extends PriceFileUploadRow {
  suppliers: { id: string; name: string } | null;
  users: { id: string; email: string; display_name: string | null } | null;
}

/** extracted_prices.review_status — post-delta lifecycle (Task 35). */
export type ExtractedPriceReviewStatus = "confident" | "needs_review" | "accepted" | "edited" | "rejected";
export const EXTRACTED_PRICE_REVIEW_STATUSES: ExtractedPriceReviewStatus[] = [
  "confident",
  "needs_review",
  "accepted",
  "edited",
  "rejected",
];

/** §1.18 extracted_prices, upgraded by the Task 35 delta migration. */
export interface ExtractedPriceRow {
  id: string;
  price_file_upload_id: string;
  matched_product_id: string | null;
  item_group_match_id: string | null;
  raw_extracted_text: unknown;
  proposed_description: string | null;
  proposed_product_ref: string | null;
  proposed_qty: number | null;
  proposed_unit_cost: number | null;
  proposed_currency: CurrencyCode | null;
  confidence_score: number | null;
  confidence_threshold_used: number | null;
  review_status: ExtractedPriceReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

/** product_price_history (Task 35, new table — Plan §2.2 Stage 4a). */
export interface ProductPriceHistoryRow {
  id: string;
  product_id: string;
  price_file_upload_id: string | null;
  unit_cost: number;
  cost_currency: CurrencyCode;
  effective_date: string;
  recorded_by: string | null;
  created_at: string;
}

/**
 * A de-duplicated summary of the engine's per-line margin flags, grouped by
 * breach type, used by the builder's override-capture UI (Task 16). `type`
 * mirrors OverrideType / the engine's MarginFlagType.
 */
export interface MarginFlagSummary {
  type: OverrideType;
  lineCount: number;
  minMarginPct: number;
  landedCostUsd: number;
  clientPriceUsd: number;
}

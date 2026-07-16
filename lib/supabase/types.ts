/**
 * Minimal hand-written row types for the tables the admin UI touches so
 * far (Tasks 5-6). Not a generated `supabase gen types` file — this repo
 * has no live Supabase project to generate against yet (see AGENTS notes
 * in the build plan). Extend as later tasks add more admin surfaces.
 */

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
  created_at: string;
  updated_at: string;
}

/** Product row joined with its supplier's name, for list display. */
export interface ProductWithSupplier extends ProductRow {
  suppliers: { id: string; name: string } | null;
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

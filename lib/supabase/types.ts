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

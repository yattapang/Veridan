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

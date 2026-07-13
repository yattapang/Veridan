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

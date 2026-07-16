/**
 * Pipeline stage mapping (Task 20, PRD §8, build plan §1.13) — PURE, no
 * Supabase client, no I/O. Mirrors the CASE expression in
 * `pipeline_view` (supabase/migrations/20260713000001_schema.sql, amended
 * by 20260717000001_pipeline_view_kpi_columns.sql) exactly, so the same
 * stage logic is unit-testable in JS and doesn't drift from the SQL that
 * actually runs. `pipeline_view` remains the source of truth for the list
 * page (one round trip); this function exists so the mapping rule itself
 * has a place to be tested and reasoned about independent of the database.
 *
 * PRD §8 stage list: Enquiry -> Technical Review -> Quote Drafted -> Sent
 * -> Accepted/Declined -> Fulfilled.
 */

import type { EnquiryStatus, ProjectStatus, QuoteStatus } from "@/lib/supabase/types";

export type PipelineStage =
  | "Enquiry"
  | "Technical Review"
  | "Quote Drafted"
  | "Sent"
  | "Accepted"
  | "Declined"
  | "Fulfilled"
  | "Unknown";

/** Display order for kanban columns / grouped-list sections. */
export const PIPELINE_STAGES: PipelineStage[] = [
  "Enquiry",
  "Technical Review",
  "Quote Drafted",
  "Sent",
  "Accepted",
  "Declined",
  "Fulfilled",
];

export interface StageInput {
  enquiryStatus: EnquiryStatus | null;
  quoteStatus: QuoteStatus | null;
  projectStatus: ProjectStatus | null;
}

/**
 * Derives a pipeline stage from enquiry status + quote status + project
 * status. Field order in the `if` chain matches the SQL CASE precedence:
 * a closed project always reads as Fulfilled regardless of quote status
 * (e.g. a fulfilled order's quote row is still technically "accepted"),
 * and a resolved quote (accepted/declined) outranks an in-progress
 * enquiry status.
 */
export function deriveStage({ enquiryStatus, quoteStatus, projectStatus }: StageInput): PipelineStage {
  if (projectStatus === "closed") return "Fulfilled";
  if (quoteStatus === "accepted") return "Accepted";
  if (quoteStatus === "declined") return "Declined";
  if (quoteStatus === "approved" || quoteStatus === "sent" || quoteStatus === "viewed" || quoteStatus === "expired") {
    return "Sent";
  }
  if (quoteStatus === "draft") return "Quote Drafted";
  if (enquiryStatus === "reviewing" || enquiryStatus === "converted") return "Technical Review";
  if (enquiryStatus === "new") return "Enquiry";
  return "Unknown";
}

export interface PipelineCard {
  enquiryId: string;
  projectId: string | null;
  quoteId: string | null;
  companyName: string | null;
  contactName: string | null;
  quoteRef: string | null;
  stage: PipelineStage;
}

/** Groups pipeline rows by stage, preserving PIPELINE_STAGES order; rows with an unrecognized/Unknown stage are dropped from the visible board rather than shown as a stray column. */
export function groupByStage<T extends { stage: PipelineStage }>(
  rows: T[],
): Record<PipelineStage, T[]> {
  const grouped = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, [] as T[]])) as Record<
    PipelineStage,
    T[]
  >;
  for (const row of rows) {
    if (row.stage in grouped) grouped[row.stage].push(row);
  }
  return grouped;
}

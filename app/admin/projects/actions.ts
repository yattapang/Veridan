"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { PROJECT_TYPES, type ProjectType } from "@/lib/supabase/types";

export type ProjectFormResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

function isProjectType(value: unknown): value is ProjectType {
  return typeof value === "string" && (PROJECT_TYPES as string[]).includes(value);
}

/**
 * Manual project creation (Task 14). The main path into `projects` is the
 * enquiry conversion flow (Task 13), but founders occasionally need to
 * start a project without a portal enquiry (repeat client, phone-in
 * request, etc.) — this form covers that, following the same inline
 * create-form pattern as companies/products/suppliers.
 */
export async function createProject(
  _prevState: ProjectFormResult,
  formData: FormData
): Promise<ProjectFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create a project." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { ok: false, error: "Project name is required." };
  }

  const companyId = String(formData.get("company_id") ?? "").trim();
  if (!companyId) {
    return { ok: false, error: "Choose a company." };
  }

  const projectType = formData.get("project_type");
  if (!isProjectType(projectType)) {
    return { ok: false, error: "Choose a valid project type." };
  }

  const siteAddress = String(formData.get("site_address") ?? "").trim();

  const { data, error } = await supabase
    .from("projects")
    .insert({
      company_id: companyId,
      name,
      site_address: siteAddress || null,
      project_type: projectType,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: `Could not create project: ${error.message}` };
  }

  revalidatePath("/admin/projects");
  redirect(`/admin/projects/${data.id}`);
}

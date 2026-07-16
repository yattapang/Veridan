"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { COMPANY_TYPES, type CompanyStatus, type CompanyType } from "@/lib/supabase/types";

export type CompanyFormResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export const initialCompanyFormResult: CompanyFormResult = { ok: true };

function isCompanyType(value: unknown): value is CompanyType {
  return typeof value === "string" && (COMPANY_TYPES as string[]).includes(value);
}

function isCompanyStatus(value: unknown): value is CompanyStatus {
  return value === "new" || value === "established";
}

function parseCompanyFields(
  formData: FormData
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { ok: false, error: "Company name is required." };
  }

  const type = formData.get("type");
  if (!isCompanyType(type)) {
    return { ok: false, error: "Choose a valid company type." };
  }

  const status = formData.get("status") ?? "new";
  if (!isCompanyStatus(status)) {
    return { ok: false, error: "Choose a valid status." };
  }

  const notes = String(formData.get("notes") ?? "").trim();

  return {
    ok: true,
    fields: { name, type, status, notes: notes || null },
  };
}

export async function createCompany(
  _prevState: CompanyFormResult,
  formData: FormData
): Promise<CompanyFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create a company." };

  const parsed = parseCompanyFields(formData);
  if (!parsed.ok) return parsed;

  const { data, error } = await supabase.from("companies").insert(parsed.fields).select("id").single();
  if (error) {
    return { ok: false, error: `Could not create company: ${error.message}` };
  }

  revalidatePath("/admin/companies");
  redirect(`/admin/companies/${data.id}`);
}

export async function updateCompany(
  id: string,
  _prevState: CompanyFormResult,
  formData: FormData
): Promise<CompanyFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to update a company." };

  const parsed = parseCompanyFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("companies").update(parsed.fields).eq("id", id);
  if (error) {
    return { ok: false, error: `Could not save company: ${error.message}` };
  }

  revalidatePath("/admin/companies");
  revalidatePath(`/admin/companies/${id}`);
  return { ok: true };
}

export type ContactFormResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export const initialContactFormResult: ContactFormResult = { ok: true };

function parseContactFields(
  formData: FormData
): { ok: true; fields: Record<string, unknown> } | { ok: false; error: string } {
  const firstName = String(formData.get("first_name") ?? "").trim();
  if (!firstName) {
    return { ok: false, error: "First name is required." };
  }

  const lastName = String(formData.get("last_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const roleTitle = String(formData.get("role_title") ?? "").trim();
  const isPrimary = formData.get("is_primary") === "on";

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address, or leave it blank." };
  }

  return {
    ok: true,
    fields: {
      first_name: firstName,
      last_name: lastName || null,
      email: email || null,
      phone: phone || null,
      role_title: roleTitle || null,
      is_primary: isPrimary,
    },
  };
}

export async function createContact(
  companyId: string,
  _prevState: ContactFormResult,
  formData: FormData
): Promise<ContactFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to add a contact." };

  const parsed = parseContactFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase
    .from("contacts")
    .insert({ ...parsed.fields, company_id: companyId });
  if (error) {
    return { ok: false, error: `Could not add contact: ${error.message}` };
  }

  revalidatePath(`/admin/companies/${companyId}`);
  return { ok: true };
}

export async function updateContact(
  companyId: string,
  contactId: string,
  _prevState: ContactFormResult,
  formData: FormData
): Promise<ContactFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to update a contact." };

  const parsed = parseContactFields(formData);
  if (!parsed.ok) return parsed;

  const { error } = await supabase.from("contacts").update(parsed.fields).eq("id", contactId);
  if (error) {
    return { ok: false, error: `Could not save contact: ${error.message}` };
  }

  revalidatePath(`/admin/companies/${companyId}`);
  return { ok: true };
}

/**
 * Contacts have no `active` flag and no historical-quote significance of
 * their own (projects.primary_contact_id is ON DELETE SET NULL), so a
 * hard delete is safe — unlike suppliers/products, there's no soft-archive
 * column on this table to use instead.
 */
export async function deleteContact(
  companyId: string,
  contactId: string
): Promise<ContactFormResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to remove a contact." };

  const { error } = await supabase.from("contacts").delete().eq("id", contactId);
  if (error) {
    return { ok: false, error: `Could not remove contact: ${error.message}` };
  }

  revalidatePath(`/admin/companies/${companyId}`);
  return { ok: true };
}

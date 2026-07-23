"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { uploadArticleHeroImage, uploadArticleSourceFile } from "@/lib/storage";
import { nextAvailableSlug, slugify } from "@/lib/articles/slug";
import type { ArticleRow, ArticleStatus } from "@/lib/supabase/types";

export type ArticleActionResult =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

export type ArticleUploadResult =
  | { ok: true; path: string; error?: undefined }
  | { ok: false; error: string };

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function nullableStr(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s.length > 0 ? s : null;
}

async function getSupabaseOrError() {
  try {
    return { supabase: await createClient(), error: null as null };
  } catch (err) {
    return { supabase: null, error: err instanceof Error ? err.message : "Supabase is not configured." };
  }
}

/** Every OTHER article's slug — used to keep a new/edited slug unique (Plan §2.4). */
async function fetchOtherSlugs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  excludeArticleId: string | null
): Promise<Set<string>> {
  let query = supabase.from("articles").select("slug");
  if (excludeArticleId) query = query.neq("id", excludeArticleId);
  const { data } = await query;
  return new Set(((data as { slug: string }[] | null) ?? []).map((r) => r.slug));
}

function revalidateArticleAdmin(articleId?: string) {
  revalidatePath("/admin/articles");
  if (articleId) revalidatePath(`/admin/articles/${articleId}/edit`);
}

/** Revalidates the public routes for a slug — call after any change that could affect a published article's public page. */
function revalidatePublicArticle(slug: string) {
  revalidateTag("articles:list", { expire: 0 });
  revalidateTag(`articles:${slug}`, { expire: 0 });
}

// ---------------------------------------------------------------------------
// Create (Plan §2.4 — /admin/articles/new)
// ---------------------------------------------------------------------------

/**
 * Creates a new article in 'draft' status from a title (+ optional drafting
 * notes, kept as source_notes). Redirects straight into the editor — the
 * rest of the fields (body, excerpt, category, hero image, SEO) are filled
 * in there. No AI call happens here; AI Assist is a separate, explicit step
 * in the editor (Plan §2.3/§2.4).
 */
export async function createArticle(
  _prevState: ArticleActionResult,
  formData: FormData
): Promise<ArticleActionResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to create an article." };

  const title = str(formData.get("title"));
  if (!title) return { ok: false, error: "Enter a title." };

  const notes = nullableStr(formData.get("source_notes"));

  const otherSlugs = await fetchOtherSlugs(supabase, null);
  const slug = nextAvailableSlug(slugify(title), otherSlugs);

  const { data, error } = await supabase
    .from("articles")
    .insert({
      title,
      slug,
      status: "draft",
      author: user.id,
      source_notes: notes,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: `Could not create the article: ${error?.message ?? "unknown error"}` };
  }

  revalidateArticleAdmin();
  redirect(`/admin/articles/${data.id}/edit`);
}

// ---------------------------------------------------------------------------
// Save fields (Plan §2.4 editor form — title/slug/excerpt/category/body/SEO)
// ---------------------------------------------------------------------------

/**
 * Saves the editable text fields of an article. Never touches `status` —
 * status transitions are separate, explicit actions below (Plan §2.4: "Draft
 * → Review → Published are explicit buttons, not implicit from field
 * edits"). If the article is already published, its public page is
 * revalidated so an edited title/excerpt/body/SEO field shows up live.
 */
export async function saveArticleFields(
  articleId: string,
  _prevState: ArticleActionResult,
  formData: FormData
): Promise<ArticleActionResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to edit an article." };

  const { data: existing, error: loadError } = await supabase
    .from("articles")
    .select("id, slug, status")
    .eq("id", articleId)
    .maybeSingle<Pick<ArticleRow, "id" | "slug" | "status">>();
  if (loadError) return { ok: false, error: `Could not load the article: ${loadError.message}` };
  if (!existing) return { ok: false, error: "Article not found." };

  const title = str(formData.get("title"));
  if (!title) return { ok: false, error: "Title is required." };

  let slug = slugify(str(formData.get("slug")) || title);
  const otherSlugs = await fetchOtherSlugs(supabase, articleId);
  if (otherSlugs.has(slug)) {
    // The founder's requested slug collides with a DIFFERENT article — pick
    // the next free variant rather than failing the whole save (Plan §2.4:
    // "unique-checked").
    slug = nextAvailableSlug(slug, otherSlugs);
  }

  const excerpt = nullableStr(formData.get("excerpt"));
  const category = nullableStr(formData.get("category"));
  const body = nullableStr(formData.get("body"));
  const seoTitle = nullableStr(formData.get("seo_title"));
  const seoDescription = nullableStr(formData.get("seo_description"));
  const sourceNotes = nullableStr(formData.get("source_notes"));
  // The editor sets this hidden field to "true" only when the founder used
  // "Accept" on an AI proposal during THIS save (client-side state) — a
  // provenance flag only, never rendered publicly (see the migration
  // comment on articles.ai_assisted).
  const aiAssistedFlag = formData.get("ai_assisted_this_save") === "true";

  const { error: updateError } = await supabase
    .from("articles")
    .update({
      title,
      slug,
      excerpt,
      category,
      body,
      seo_title: seoTitle,
      seo_description: seoDescription,
      source_notes: sourceNotes,
      ...(aiAssistedFlag ? { ai_assisted: true } : {}),
    })
    .eq("id", articleId);

  if (updateError) return { ok: false, error: `Could not save: ${updateError.message}` };

  revalidateArticleAdmin(articleId);
  if (existing.status === "published") {
    revalidatePublicArticle(existing.slug);
    if (slug !== existing.slug) revalidatePublicArticle(slug);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Hero image upload
// ---------------------------------------------------------------------------

export async function saveHeroImage(
  articleId: string,
  _prevState: ArticleActionResult,
  formData: FormData
): Promise<ArticleActionResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to upload a hero image." };

  const file = formData.get("hero_image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image file." };
  }

  const { path, error } = await uploadArticleHeroImage(supabase, articleId, file);
  if (error || !path) return { ok: false, error: `Could not upload the image: ${error ?? "unknown error"}` };

  const { data: existing } = await supabase
    .from("articles")
    .select("slug, status")
    .eq("id", articleId)
    .maybeSingle<Pick<ArticleRow, "slug" | "status">>();

  const { error: updateError } = await supabase
    .from("articles")
    .update({ hero_image_path: path })
    .eq("id", articleId);
  if (updateError) return { ok: false, error: `Image uploaded but could not be saved: ${updateError.message}` };

  revalidateArticleAdmin(articleId);
  if (existing?.status === "published") revalidatePublicArticle(existing.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// AI-drafted source file upload (feeds app/api/articles/[id]/ai-draft)
// ---------------------------------------------------------------------------

export async function uploadAiSourceFile(
  articleId: string,
  formData: FormData
): Promise<ArticleUploadResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to attach a source file." };

  const file = formData.get("source_file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to attach." };
  }

  const { path, error } = await uploadArticleSourceFile(supabase, articleId, file);
  if (error || !path) return { ok: false, error: `Could not upload the file: ${error ?? "unknown error"}` };

  return { ok: true, path };
}

// ---------------------------------------------------------------------------
// Status transitions — EXPLICIT, one per direction (Plan §2.4/§2.6: never
// implicit, never autonomous).
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<ArticleStatus, ArticleStatus[]> = {
  draft: ["review"],
  review: ["draft", "published"],
  published: ["draft"], // unpublish — pulls the article back off the public site
};

async function changeArticleStatus(articleId: string, to: ArticleStatus): Promise<ArticleActionResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in to change an article's status." };

  const { data: existing, error: loadError } = await supabase
    .from("articles")
    .select("id, slug, status, title, body")
    .eq("id", articleId)
    .maybeSingle<Pick<ArticleRow, "id" | "slug" | "status" | "title" | "body">>();
  if (loadError) return { ok: false, error: `Could not load the article: ${loadError.message}` };
  if (!existing) return { ok: false, error: "Article not found." };

  if (!ALLOWED_TRANSITIONS[existing.status].includes(to)) {
    return { ok: false, error: `An article in "${existing.status}" cannot move directly to "${to}".` };
  }

  if (to === "published" && !existing.body?.trim()) {
    return { ok: false, error: "Add a body before publishing — an article can't publish empty." };
  }

  const patch: Record<string, unknown> = { status: to };
  // published_at is set ONLY on the publish transition (Plan §6.2 UAT item 3).
  if (to === "published") patch.published_at = new Date().toISOString();

  const { error: updateError } = await supabase.from("articles").update(patch).eq("id", articleId);
  if (updateError) return { ok: false, error: `Could not update status: ${updateError.message}` };

  revalidateArticleAdmin(articleId);
  // Revalidate the public routes on EVERY transition that touches
  // publication state — publishing (now visible), unpublishing (now
  // hidden), and moving out of review back to draft (still hidden, but
  // cheap and harmless to revalidate).
  revalidatePublicArticle(existing.slug);

  return { ok: true };
}

export async function moveArticleToReview(articleId: string): Promise<ArticleActionResult> {
  return changeArticleStatus(articleId, "review");
}

export async function revertArticleToDraft(articleId: string): Promise<ArticleActionResult> {
  return changeArticleStatus(articleId, "draft");
}

export async function publishArticle(articleId: string): Promise<ArticleActionResult> {
  return changeArticleStatus(articleId, "published");
}

// ---------------------------------------------------------------------------
// LinkedIn cross-post marker (Plan §2.4/§2.6 — deterministic client-side
// template + clipboard copy; this action ONLY records that it was copied,
// it never calls any LinkedIn endpoint).
// ---------------------------------------------------------------------------

export async function markLinkedinCrossPosted(articleId: string): Promise<ArticleActionResult> {
  const { supabase, error: clientError } = await getSupabaseOrError();
  if (!supabase) return { ok: false, error: clientError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const { error } = await supabase
    .from("articles")
    .update({ linkedin_cross_posted: true })
    .eq("id", articleId);
  if (error) return { ok: false, error: error.message };

  revalidateArticleAdmin(articleId);
  return { ok: true };
}

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { articleHeroImagePublicUrl } from "@/lib/storage";
import { siteMeta } from "@/lib/site-content";
import type { ArticleRow } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { ArticleEditor } from "./ArticleEditor";

export const metadata = {
  title: "Edit Article",
};

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <InstructiveMessage
        title="Supabase is not configured"
        body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
      />
    );
  }

  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .eq("id", id)
    .maybeSingle<ArticleRow>();

  if (error) {
    return (
      <InstructiveMessage
        title="Could not reach the database"
        body={`This article couldn't be loaded (${error.message}).`}
      />
    );
  }
  if (!data) notFound();

  const heroImageUrl = articleHeroImagePublicUrl(supabase, data.hero_image_path);
  const publicUrl = `${siteMeta.siteUrl}/articles/${data.slug}`;

  return <ArticleEditor article={data} heroImageUrl={heroImageUrl} publicUrl={publicUrl} />;
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { ArticleStatus, ArticleWithAuthor } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";

export const metadata = {
  title: "Articles",
};

const TABS: { key: ArticleStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "review", label: "Review" },
  { key: "published", label: "Published" },
];

const STATUS_BADGE_CLASS: Record<ArticleStatus, string> = {
  draft: "bg-veridan-warm-gray-pale text-veridan-warm-gray",
  review: "bg-amber-50 text-amber-800",
  published: "bg-emerald-50 text-emerald-800",
};

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const activeTab: ArticleStatus | "all" =
    statusParam === "draft" || statusParam === "review" || statusParam === "published"
      ? statusParam
      : "all";

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Articles</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let query = supabase
    .from("articles")
    .select("*, users(id, email, display_name)")
    .order("updated_at", { ascending: false });
  if (activeTab !== "all") query = query.eq("status", activeTab);

  const { data, error } = await query;

  const rows = (data as ArticleWithAuthor[] | null) ?? [];

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-veridan-ink">Articles</h1>
        <Link
          href="/admin/articles/new"
          className="rounded-md bg-veridan-ink px-4 py-2 text-xs font-medium uppercase tracking-wide text-veridan-paper transition-opacity duration-150 hover:opacity-90"
        >
          New article
        </Link>
      </div>

      <nav aria-label="Filter by status" className="mb-6 flex gap-1 border-b border-veridan-warm-gray-light">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "all" ? "/admin/articles" : `/admin/articles?status=${tab.key}`}
            className={`border-b-2 px-3 py-2 text-xs font-medium uppercase tracking-wide ${
              activeTab === tab.key
                ? "border-veridan-ink text-veridan-ink"
                : "border-transparent text-veridan-warm-gray hover:text-veridan-ink"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {error ? (
        <InstructiveMessage
          title="Could not reach the database"
          body={`The articles table couldn't be loaded (${error.message}). Check that the Supabase project is running and the migrations in supabase/migrations have been applied, then reload.`}
        />
      ) : rows.length === 0 ? (
        <InstructiveMessage
          title="No articles yet"
          body="Create a new article to draft your first post."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-veridan-warm-gray-light bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-veridan-warm-gray-pale text-xs uppercase tracking-wide text-veridan-warm-gray">
              <tr>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Author</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((article) => (
                <tr key={article.id} className="border-t border-veridan-warm-gray-light">
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE_CLASS[article.status]}`}
                    >
                      {article.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/articles/${article.id}/edit`}
                      className="font-medium text-veridan-ink hover:text-veridan-accent-text"
                    >
                      {article.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-veridan-warm-gray">{article.category ?? "—"}</td>
                  <td className="px-4 py-3 text-veridan-warm-gray">
                    {article.users?.display_name ?? article.users?.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-veridan-warm-gray">
                    {new Date(article.updated_at).toLocaleDateString("en-JM")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

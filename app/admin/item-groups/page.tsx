import { createClient } from "@/lib/supabase/server";
import type { ItemGroupWithProductCount } from "@/lib/supabase/types";
import { InstructiveMessage } from "@/components/admin/InstructiveMessage";
import { ItemGroupForm } from "./ItemGroupForm";
import { ItemGroupListItem } from "./ItemGroupListItem";
import { MergeForm } from "./MergeForm";

export const metadata = {
  title: "Item Groups",
};

export default async function ItemGroupsPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Item Groups</h1>
        <InstructiveMessage
          title="Supabase is not configured"
          body="NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from the environment. Copy .env.example to .env.local and fill them in, then reload."
        />
      </div>
    );
  }

  let data: ItemGroupWithProductCount[] | null = null;
  let loadError: string | null = null;

  try {
    const { data: rows, error } = await supabase
      .from("item_groups")
      .select("*, products(count)")
      .order("family_name");

    if (error) {
      loadError = error.message;
    } else {
      data = rows as unknown as ItemGroupWithProductCount[];
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error reaching Supabase.";
  }

  if (loadError) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-veridan-ink">Item Groups</h1>
        <InstructiveMessage
          title="Could not reach the database"
          body={`The item_groups table couldn't be loaded (${loadError}). Check that the migrations in supabase/migrations have been applied, then reload.`}
        />
      </div>
    );
  }

  const itemGroups = data ?? [];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Item Groups</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        The canonical &quot;this is the same physical item&quot; identity across suppliers, finishes,
        and design variants (Phase 2A). Products opt into a group; nothing in the Hardware Library
        is required to have one.
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Create an item group
        </h2>
        <ItemGroupForm />
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          All item groups
        </h2>
        {itemGroups.length === 0 ? (
          <InstructiveMessage
            title="No item groups yet"
            body="Create your first group above, e.g. &ldquo;Commercial Lever Lockset, Grade 1&rdquo;."
          />
        ) : (
          <ul className="rounded-md border border-veridan-warm-gray-light bg-white px-5">
            {itemGroups.map((g) => (
              <ItemGroupListItem key={g.id} itemGroup={g} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Merge two groups
        </h2>
        <p className="mb-4 text-xs text-veridan-warm-gray">
          If two groups turn out to describe the same physical item, merge them instead of manually
          re-entering products. All products in the losing group are re-pointed to the surviving
          group, and the merge is recorded in the audit log.
        </p>
        <MergeForm itemGroups={itemGroups} />
      </section>
    </div>
  );
}

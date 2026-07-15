/**
 * Shared "something's not right, here's what to do" panel used across
 * admin list pages when Supabase is unreachable/unconfigured or a table
 * is empty. Extracted from the pattern established in
 * app/admin/parameters/page.tsx (Task 6) so Tasks 10-12 don't each
 * reimplement the same JSX.
 */
export function InstructiveMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-xl rounded-md border border-veridan-warm-gray-light bg-veridan-warm-gray-pale px-5 py-4">
      <p className="text-sm font-medium text-veridan-ink">{title}</p>
      <p className="mt-1 text-sm text-veridan-warm-gray">{body}</p>
    </div>
  );
}

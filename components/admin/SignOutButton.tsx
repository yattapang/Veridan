import { signOut } from "@/lib/auth";

/**
 * Small sign-out control for the admin shell. Uses a Server Action bound
 * directly to the form so it works without client-side JS.
 */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="rounded-md border border-veridan-warm-gray-light px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-veridan-ink/70 transition-colors duration-150 hover:border-veridan-ink hover:text-veridan-ink"
      >
        Sign out
      </button>
    </form>
  );
}

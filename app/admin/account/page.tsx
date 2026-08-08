import { requireAdminArea } from "@/lib/roles/guards";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata = {
  title: "Your account",
};

/**
 * Your own account. Open to BOTH roles on purpose — staff must be able to
 * change their own password without a founder ever touching it.
 */
export default async function AccountPage() {
  const session = await requireAdminArea("account");

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold text-veridan-ink">Your account</h1>
      <p className="mt-2 text-sm text-veridan-warm-gray">
        Signed in as {session.user.display_name || session.user.email} (
        {session.role === "founder" ? "Founder" : "Staff"}).
      </p>

      <section className="mt-8 rounded-md border border-veridan-warm-gray-light bg-white px-5 py-5">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-veridan-warm-gray">
          Change your password
        </h2>
        <p className="mb-4 text-xs text-veridan-warm-gray">
          This changes only your own password, in your own browser session. Nobody else — founder
          included — can see or set it.
        </p>
        <ChangePasswordForm />
      </section>

      <p className="mt-6 text-xs text-veridan-warm-gray">
        Forgotten it instead? Sign out and use{" "}
        <span className="font-medium">Forgot password?</span> on the sign-in page — Veridan emails
        you a one-time link.
      </p>
    </div>
  );
}

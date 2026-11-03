import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { setNewPassword } from "./actions";

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const supabase = await createClient();
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    redirect("/forgot-password?status=expired");
  }

  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-12">
      <section className="w-full rounded-2xl border border-black/10 p-6 shadow-sm dark:border-white/15">
        <p className="text-sm font-medium text-black/60 dark:text-white/60">blindstats</p>
        <h1 className="mt-2 text-2xl font-semibold">Choose a new password</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          Enter a new password for your blindstats account.
        </p>

        {error === "invalid" ? (
          <p className="mt-5 text-sm" role="alert">Use a password between 8 and 128 characters.</p>
        ) : null}
        {error === "mismatch" ? (
          <p className="mt-5 text-sm" role="alert">The passwords do not match.</p>
        ) : null}
        {error === "failed" ? (
          <p className="mt-5 text-sm" role="alert">
            We could not update your password. Try again or request a new reset link.
          </p>
        ) : null}

        <form action={setNewPassword} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="new-password">New password</label>
            <input
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
              id="new-password"
              maxLength={128}
              minLength={8}
              name="password"
              required
              type="password"
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="confirm-password">Confirm new password</label>
            <input
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
              id="confirm-password"
              maxLength={128}
              minLength={8}
              name="confirmPassword"
              required
              type="password"
            />
          </div>
          <button className="w-full rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background" type="submit">
            Update password
          </button>
        </form>
        <Link className="mt-6 inline-block text-sm font-medium underline underline-offset-4" href="/forgot-password">
          Request a new reset link
        </Link>
      </section>
    </main>
  );
}

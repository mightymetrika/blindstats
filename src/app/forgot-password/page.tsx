import Link from "next/link";

import { requestPasswordReset } from "./actions";

type ForgotPasswordPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const { status } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-12">
      <section className="w-full rounded-2xl border border-black/10 p-6 shadow-sm dark:border-white/15">
        <p className="text-sm font-medium text-black/60 dark:text-white/60">blindstats</p>
        <h1 className="mt-2 text-2xl font-semibold">Reset your password</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          Enter your account email address to request a password-reset link.
        </p>

        {status === "sent" ? (
          <p className="mt-5 rounded-lg border border-black/15 p-3 text-sm dark:border-white/20" role="status">
            If an account exists for that address, we&apos;ve sent password-reset instructions.
            Check your inbox and spam folder.
          </p>
        ) : null}
        {status === "expired" ? (
          <p className="mt-5 rounded-lg border border-black/15 p-3 text-sm dark:border-white/20" role="alert">
            Your reset link may have expired or is invalid. Request a new link below.
          </p>
        ) : null}
        {status === "invalid" ? (
          <p className="mt-5 rounded-lg border border-black/15 p-3 text-sm dark:border-white/20" role="alert">
            Enter a valid email address.
          </p>
        ) : null}
        {status === "unavailable" ? (
          <p className="mt-5 rounded-lg border border-black/15 p-3 text-sm dark:border-white/20" role="alert">
            We could not process the request right now. Please try again later.
          </p>
        ) : null}

        <form action={requestPasswordReset} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="recovery-email">Email</label>
            <input
              autoComplete="email"
              className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
              id="recovery-email"
              maxLength={320}
              name="email"
              required
              type="email"
            />
          </div>
          <button className="w-full rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background" type="submit">
            Send reset link
          </button>
        </form>
        <Link className="mt-6 inline-block text-sm font-medium underline underline-offset-4" href="/login">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}

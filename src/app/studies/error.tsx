"use client";

import Link from "next/link";

type StudiesErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function StudiesError({ reset }: StudiesErrorProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-12">
      <section
        className="w-full rounded-2xl border border-black/10 p-6 shadow-sm dark:border-white/15"
        role="alert"
      >
        <p className="text-sm font-medium text-black/60 dark:text-white/60">
          blindstats
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          Unable to load Study information
        </h1>
        <p className="mt-3 text-sm text-black/60 dark:text-white/60">
          Something went wrong while loading this workspace. This may be
          temporary. Please try again. If the problem continues, you can return
          to sign in.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
            onClick={() => reset()}
            type="button"
          >
            Try again
          </button>
          <Link
            className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
            href="/login"
          >
            Return to sign in
          </Link>
        </div>
      </section>
    </main>
  );
}

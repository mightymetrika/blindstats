export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-12">
      <section className="w-full rounded-2xl border border-black/10 p-6 shadow-sm dark:border-white/15">
        <p className="text-sm font-medium text-black/60 dark:text-white/60">blindstats</p>
        <h1 className="mt-2 text-2xl font-semibold">Check your email</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">Confirm your email address, then return to blindstats to continue.</p>
        <a className="mt-6 inline-block text-sm font-medium underline underline-offset-4" href="/login">Back to sign in</a>
      </section>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { createStudy } from "./actions";

export default async function StudiesPage() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) {
    redirect("/login");
  }

  const [
    { data: profile, error: profileError },
    { data: studies, error: studiesError },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", claims.sub)
      .single(),
    supabase
      .from("studies")
      .select("id, name, description, lifecycle, created_at")
      .order("created_at", { ascending: false }),
  ]);

  if (profileError) {
    throw new Error(`Unable to load profile: ${profileError.message}`);
  }

  if (studiesError) {
    throw new Error(`Unable to load Studies: ${studiesError.message}`);
  }

  const email = typeof claims.email === "string" ? claims.email : null;
  const identity = profile.display_name || email || "Signed-in user";

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
      <header className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-black/60 dark:text-white/60">
            blindstats
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Studies</h1>
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">
            Signed in as {identity}.
          </p>
        </div>

        <form action="/auth/signout" method="post">
          <button
            className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-10 rounded-2xl border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-semibold">Create Study</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Create a persistent workspace for a research study.
        </p>

        <form action={createStudy} className="mt-5 space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="name">
              Study name
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
              id="name"
              name="name"
              type="text"
              maxLength={200}
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="description">
              Description
            </label>
            <textarea
              className="mt-1 min-h-24 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
              id="description"
              name="description"
              maxLength={2000}
            />
          </div>

          <button
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
            type="submit"
          >
            Create Study
          </button>
        </form>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Your Studies</h2>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">
              Studies you can access appear here.
            </p>
          </div>
          <p className="text-sm text-black/50 dark:text-white/50">
            {studies.length} {studies.length === 1 ? "Study" : "Studies"}
          </p>
        </div>

        {studies.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-black/20 p-8 dark:border-white/20">
            <h3 className="font-semibold">No Studies yet</h3>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">
              Create your first Study above.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            {studies.map((study) => (
              <Link
                className="rounded-2xl border border-black/10 p-5 transition hover:border-black/25 dark:border-white/15 dark:hover:border-white/30"
                href={`/studies/${study.id}`}
                key={study.id}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{study.name}</h3>
                    {study.description ? (
                      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                        {study.description}
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium capitalize text-black/60 dark:border-white/15 dark:text-white/60">
                    {study.lifecycle}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

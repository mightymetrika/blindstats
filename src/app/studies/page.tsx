import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function StudiesPage() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", claims.sub)
    .single();

  if (profileError) {
    throw new Error(`Unable to load profile: ${profileError.message}`);
  }

  const email = typeof claims.email === "string" ? claims.email : null;
  const identity = profile.display_name || email || "Signed-in user";

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12">
      <header className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-black/60 dark:text-white/60">blindstats</p>
          <h1 className="mt-2 text-3xl font-semibold">Studies</h1>
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">Signed in as {identity}.</p>
        </div>
        <form action="/auth/signout" method="post">
          <button className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20" type="submit">Sign out</button>
        </form>
      </header>

      <section className="mt-10 rounded-2xl border border-dashed border-black/20 p-8 dark:border-white/20">
        <h2 className="text-lg font-semibold">Authentication connected</h2>
        <p className="mt-2 max-w-2xl text-sm text-black/60 dark:text-white/60">Your authenticated profile was loaded through the server-backed blindstats data layer. Persistent Study creation is the next checkpoint.</p>
      </section>
    </main>
  );
}

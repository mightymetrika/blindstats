import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type StudyPageProps = {
  params: Promise<{
    studyId: string;
  }>;
};

export default async function StudyPage({ params }: StudyPageProps) {
  const { studyId } = await params;
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: study, error } = await supabase
    .from("studies")
    .select("id, name, description, lifecycle, created_at, updated_at")
    .eq("id", studyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load Study: ${error.message}`);
  }

  if (!study) {
    notFound();
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
      <Link
        className="text-sm font-medium text-black/60 underline underline-offset-4 dark:text-white/60"
        href="/studies"
      >
        Back to Studies
      </Link>

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{study.name}</h1>
          <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium capitalize text-black/60 dark:border-white/15 dark:text-white/60">
            {study.lifecycle}
          </span>
        </div>

        {study.description ? (
          <p className="mt-3 max-w-3xl text-black/65 dark:text-white/65">
            {study.description}
          </p>
        ) : null}
      </header>

      <section className="mt-10 rounded-2xl border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-semibold">Study workspace</h2>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          This Study is persistent and access-controlled. Research workflows
          added to this Study will appear here.
        </p>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-black/10 p-5 dark:border-white/15">
          <p className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
            Created
          </p>
          <p className="mt-2 text-sm">
            {new Date(study.created_at).toLocaleString("en-US")}
          </p>
        </div>

        <div className="rounded-2xl border border-black/10 p-5 dark:border-white/15">
          <p className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
            Last updated
          </p>
          <p className="mt-2 text-sm">
            {new Date(study.updated_at).toLocaleString("en-US")}
          </p>
        </div>
      </section>
    </main>
  );
}

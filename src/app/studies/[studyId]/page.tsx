import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { createBlindingWorkflow } from "./blinding/actions";

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

  const [
    { data: study, error: studyError },
    { data: workflow, error: workflowError },
  ] = await Promise.all([
    supabase
      .from("studies")
      .select("id, name, description, lifecycle, created_at, updated_at")
      .eq("id", studyId)
      .maybeSingle(),
    supabase
      .from("blinding_workflows")
      .select("id, state, created_at")
      .eq("study_id", studyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (studyError) {
    throw new Error(`Unable to load Study: ${studyError.message}`);
  }

  if (workflowError) {
    throw new Error(
      `Unable to load blinding workflow: ${workflowError.message}`,
    );
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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Blinding workflow</h2>
            <p className="mt-2 max-w-2xl text-sm text-black/60 dark:text-white/60">
              Configure the analyst-blinding workflow for this Study.
            </p>
          </div>

          {workflow ? (
            <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium capitalize text-black/60 dark:border-white/15 dark:text-white/60">
              {workflow.state.replaceAll("_", " ")}
            </span>
          ) : null}
        </div>

        {workflow ? (
          <Link
            className="mt-5 inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
            href={`/studies/${study.id}/blinding/${workflow.id}`}
          >
            Open blinding workflow
          </Link>
        ) : (
          <form action={createBlindingWorkflow} className="mt-5">
            <input type="hidden" name="studyId" value={study.id} />
            <button
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              type="submit"
            >
              Create blinding workflow
            </button>
          </form>
        )}
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

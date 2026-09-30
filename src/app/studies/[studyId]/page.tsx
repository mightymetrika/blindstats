import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { createBlindingWorkflow } from "./blinding/actions";

type StudyPageProps = {
  params: Promise<{
    studyId: string;
  }>;
};

function hasDistinctDescription(
  name: string,
  description: string | null,
): boolean {
  if (!description?.trim()) {
    return false;
  }

  return description.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase();
}

function formatWorkflowState(state: string): string {
  switch (state) {
    case "setup":
      return "Setup";
    case "blinded":
      return "Blinded";
    case "unblinding_authorized":
      return "Authorized";
    case "unblinded":
      return "Unblinded";
    default:
      return state.replaceAll("_", " ");
  }
}

export default async function StudyPage({ params }: StudyPageProps) {
  const { studyId } = await params;
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const currentUserId = claimsData.claims.sub as string;

  const [
    { data: study, error: studyError },
    { data: workflow, error: workflowError },
    { data: currentCapabilities, error: capabilitiesError },
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
    supabase
      .from("study_capabilities")
      .select("capability")
      .eq("study_id", studyId)
      .eq("user_id", currentUserId),
  ]);

  if (studyError) {
    throw new Error(`Unable to load Study: ${studyError.message}`);
  }

  if (workflowError) {
    throw new Error(
      `Unable to load blinding workflow: ${workflowError.message}`,
    );
  }

  if (capabilitiesError) {
    throw new Error(
      `Unable to load Study capabilities: ${capabilitiesError.message}`,
    );
  }

  if (!study) {
    notFound();
  }

  const capabilitySet = new Set(
    (currentCapabilities ?? []).map((entry) => entry.capability),
  );
  const canConfigureBlinding = capabilitySet.has("blinding.configure");
  const canCreateBlinding = capabilitySet.has("blinding.create");
  const canLockAnalysis = capabilitySet.has("analysis.lock");
  const canRequestUnblinding = capabilitySet.has("unblinding.request");
  const canAuthorizeUnblinding = capabilitySet.has("unblinding.authorize");
  const canReceiveUnblinded = capabilitySet.has("unblinded.receive");

  const isBlindedAnalyst =
    canLockAnalysis &&
    canRequestUnblinding &&
    canReceiveUnblinded &&
    !canCreateBlinding &&
    !canAuthorizeUnblinding;

  const isBlindingCustodian =
    canConfigureBlinding &&
    canCreateBlinding &&
    canAuthorizeUnblinding &&
    !canLockAnalysis &&
    !canRequestUnblinding &&
    !canReceiveUnblinded;

  const roleLabel = workflow
    ? isBlindedAnalyst
      ? "Blinded analyst"
      : isBlindingCustodian
        ? "Blinding custodian"
        : null
    : null;

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

        {hasDistinctDescription(study.name, study.description) ? (
          <p className="mt-3 max-w-3xl text-black/65 dark:text-white/65">
            {study.description}
          </p>
        ) : null}
      </header>

      <section className="mt-10">
        <div>
          <h2 className="text-xl font-semibold">Research workflows</h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Open a workflow to continue the Study.
          </p>
        </div>

        <article className="mt-5 rounded-2xl border border-black/10 p-6 dark:border-white/15">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Blinding</h3>
              <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                Auditable analyst blinding.
              </p>
              {roleLabel ? (
                <p className="mt-3 text-sm text-black/55 dark:text-white/55">
                  Role: {roleLabel}
                </p>
              ) : null}
            </div>

            <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium text-black/60 dark:border-white/15 dark:text-white/60">
              {workflow ? formatWorkflowState(workflow.state) : "Not started"}
            </span>
          </div>

          {workflow ? (
            <Link
              className="mt-5 inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              href={`/studies/${study.id}/blinding/${workflow.id}`}
            >
              Open workflow
            </Link>
          ) : canConfigureBlinding ? (
            <form action={createBlindingWorkflow} className="mt-5">
              <input type="hidden" name="studyId" value={study.id} />
              <button
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                type="submit"
              >
                Create workflow
              </button>
            </form>
          ) : (
            <p className="mt-5 text-sm text-black/60 dark:text-white/60">
              Waiting for a Study member with blinding configuration access to
              create the workflow.
            </p>
          )}
        </article>
      </section>

      <details className="mt-8 rounded-2xl border border-black/10 p-5 text-sm dark:border-white/15">
        <summary className="cursor-pointer font-medium">Study details</summary>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
              Created
            </dt>
            <dd className="mt-1">
              {new Date(study.created_at).toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
              Last updated
            </dt>
            <dd className="mt-1">
              {new Date(study.updated_at).toLocaleString("en-US")}
            </dd>
          </div>
        </dl>
      </details>
    </main>
  );
}

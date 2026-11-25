import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { StudyEncryptionSetup } from "@/components/research-transfer/StudyEncryptionSetup";
import { SignOutButton } from "@/components/SignOutButton";
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
      .select("id, name, description, lifecycle, created_at, updated_at, file_protection")
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
    !canConfigureBlinding &&
    !canAuthorizeUnblinding;

  const isBlindingCustodian =
    canConfigureBlinding &&
    canCreateBlinding &&
    canAuthorizeUnblinding &&
    !canLockAnalysis &&
    !canRequestUnblinding &&
    !canReceiveUnblinded;

  const strictProtection = study.file_protection === "recipient_e2ee_v1";
  let encryptionReady = false;
  let analystCount = 0;
  let readyCount = 0;
  if (strictProtection && isBlindedAnalyst) {
    const key = await supabase.from("research_transfer_key_backups").select("user_id")
      .eq("study_id", studyId).eq("user_id", currentUserId).maybeSingle();
    if (key.error) throw new Error("Unable to load Study encryption readiness.");
    encryptionReady = Boolean(key.data);
  }
  if (strictProtection && isBlindingCustodian) {
    const [roles, keys] = await Promise.all([
      supabase.from("study_capabilities").select("user_id, capability").eq("study_id", studyId),
      supabase.from("research_transfer_public_keys").select("user_id").eq("study_id", studyId),
    ]);
    if (roles.error || keys.error) throw new Error("Unable to load analyst encryption readiness.");
    const byUser = new Map<string, Set<string>>();
    for (const row of roles.data ?? []) {
      const capabilities = byUser.get(row.user_id) ?? new Set<string>();
      capabilities.add(row.capability); byUser.set(row.user_id, capabilities);
    }
    const analysts = [...byUser].filter(([, capabilities]) =>
      ["analysis.lock", "unblinding.request", "unblinded.receive"].every(c => capabilities.has(c)) &&
      ["blinding.create", "blinding.configure", "unblinding.authorize"].every(c => !capabilities.has(c)));
    const ready = new Set((keys.data ?? []).map(k => k.user_id));
    analystCount = analysts.length;
    readyCount = analysts.filter(([id]) => ready.has(id)).length;
  }

  const roleLabel = workflow
    ? isBlindedAnalyst
      ? "Blinded analyst"
      : isBlindingCustodian
        ? "Blinding custodian"
        : null
    : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          className="text-sm font-medium text-black/60 underline underline-offset-4 dark:text-white/60"
          href="/studies"
        >
          Back to Studies
        </Link>
        <SignOutButton />
      </div>

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

      <section className="mt-6 rounded-2xl border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-lg font-semibold">File protection</h2>
        <p className="mt-2 text-sm">{strictProtection ? "Recipient-only encryption required" : "Managed secure storage (not end-to-end encrypted)"}</p>
        {strictProtection && isBlindedAnalyst ? <div className="mt-3">
          {encryptionReady ? <p className="text-sm">Encryption ready</p> : <StudyEncryptionSetup studyId={studyId} userId={currentUserId} />}
        </div> : null}
        {strictProtection && isBlindingCustodian ? <p className="mt-2 text-sm">{!analystCount ? "Assign a blinded analyst" : readyCount === analystCount ? "Ready to send" : `Waiting for analyst encryption setup (${readyCount}/${analystCount} ready)`}</p> : null}
      </section>

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

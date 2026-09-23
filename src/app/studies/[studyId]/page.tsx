import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { assignBlindedAnalyst } from "./actions";
import { createBlindingWorkflow } from "./blinding/actions";

type StudyPageProps = {
  params: Promise<{
    studyId: string;
  }>;
  searchParams: Promise<{
    analystAssigned?: string;
    analystError?: string;
  }>;
};

function getAnalystErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "account_not_found":
      return "No existing blindstats account was found for that email. The person must create an account first.";
    case "same_account":
      return "The blinded analyst must use a different authenticated account.";
    case "not_authorized":
      return "You do not have permission to manage Study membership and capabilities.";
    case "custodian_capabilities":
      return "Your account does not currently have the blinding and authorization capabilities required to become the Study custodian.";
    case "acknowledgement_required":
      return "Confirm the two-party role separation before assigning the blinded analyst.";
    case "unable":
      return "The blinded analyst could not be assigned. Reload the Study and try again.";
    default:
      return null;
  }
}

export default async function StudyPage({
  params,
  searchParams,
}: StudyPageProps) {
  const { studyId } = await params;
  const { analystAssigned, analystError } = await searchParams;
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
  const canManageMembership = capabilitySet.has("membership.manage");
  const canManageCapabilities = capabilitySet.has("capability.manage");
  const canAssignBlindedAnalyst =
    canManageMembership && canManageCapabilities;

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

  const analystErrorMessage = getAnalystErrorMessage(analystError);

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

      {isBlindedAnalyst ? (
        <section className="mt-8 rounded-2xl border border-black/10 p-5 dark:border-white/15">
          <p className="text-sm font-medium">Your Study access: Blinded analyst</p>
          <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
            You may lock the blinded analysis, request unblinding, and receive
            authorized unblinded information. You cannot create the blinding or
            authorize your own unblinding request.
          </p>
        </section>
      ) : null}

      {isBlindingCustodian ? (
        <section className="mt-8 rounded-2xl border border-black/10 p-5 dark:border-white/15">
          <p className="text-sm font-medium">Your Study access: Blinding custodian</p>
          <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
            You may configure and create the blinding and independently authorize
            unblinding. The blinded analyst is responsible for locking the
            analysis, requesting unblinding, and completing the authorized local
            unblinding.
          </p>
        </section>
      ) : null}

      <section className="mt-10 rounded-2xl border border-black/10 p-6 dark:border-white/15">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Blinding workflow</h2>
            <p className="mt-2 max-w-2xl text-sm text-black/60 dark:text-white/60">
              Configure and carry out the analyst-blinding workflow for this Study.
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
        ) : canConfigureBlinding ? (
          <form action={createBlindingWorkflow} className="mt-5">
            <input type="hidden" name="studyId" value={study.id} />
            <button
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              type="submit"
            >
              Create blinding workflow
            </button>
          </form>
        ) : (
          <p className="mt-5 text-sm text-black/60 dark:text-white/60">
            No blinding workflow has been created for this Study. Your current
            Study capabilities do not allow you to create one.
          </p>
        )}
      </section>

      {canAssignBlindedAnalyst ? (
        <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
          <h2 className="text-lg font-semibold">Two-party analyst blinding</h2>
          <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
            Assign an existing blindstats account as the blinded analyst. The
            analyst will receive only analysis.lock, unblinding.request, and
            unblinded.receive for this Study. Your account will remain the
            blinding custodian and authorizer, and will no longer hold those
            analyst-side capabilities.
          </p>

          {analystAssigned === "1" ? (
            <div className="mt-4 rounded-xl border border-black/10 p-4 dark:border-white/15">
              <p className="text-sm font-medium">Blinded analyst assigned.</p>
              <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                The Study now has separated custodian and analyst capabilities.
              </p>
            </div>
          ) : null}

          {analystErrorMessage ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
              <p className="text-sm font-medium">Unable to assign blinded analyst</p>
              <p className="mt-1 text-sm">{analystErrorMessage}</p>
            </div>
          ) : null}

          <form action={assignBlindedAnalyst} className="mt-5 space-y-4">
            <input type="hidden" name="studyId" value={study.id} />
            <div>
              <label className="text-sm font-medium" htmlFor="analystEmail">
                Existing analyst account email
              </label>
              <input
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
                id="analystEmail"
                name="analystEmail"
                placeholder="analyst@example.com"
                required
                type="email"
              />
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                The account must already exist in blindstats and must be
                different from your current account.
              </p>
            </div>

            <label className="flex max-w-3xl items-start gap-3 text-sm">
              <input
                className="mt-1"
                name="acknowledgeRoleSeparation"
                required
                type="checkbox"
              />
              <span>
                I understand that this separates the Study roles: I will retain
                blinding and authorization responsibility, while the selected
                analyst will lock the analysis, request unblinding, and receive
                authorized unblinded information.
              </span>
            </label>

            <button
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              type="submit"
            >
              Assign blinded analyst and separate roles
            </button>
          </form>
        </section>
      ) : null}

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

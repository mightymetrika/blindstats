import { Buffer } from "node:buffer";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AnalysisLockWorkspace } from "@/components/blinding/AnalysisLockWorkspace";
import { BlindingWorkspace } from "@/components/blinding/BlindingWorkspace";
import { UnblindingWorkspace } from "@/components/blinding/UnblindingWorkspace";
import { createClient } from "@/lib/supabase/server";

import { assignBlindedAnalyst } from "../../actions";
import {
  activateBlindingPlan,
  authorizeUnblinding,
  registerAnalysisLock,
  registerBlindingTransformation,
  registerUnblindingCompletion,
  requestUnblinding,
  saveBlindingPlanDraft,
} from "../actions";

type BlindingWorkflowPageProps = {
  params: Promise<{
    studyId: string;
    workflowId: string;
  }>;
  searchParams: Promise<{
    saved?: string;
    activated?: string;
    blinded?: string;
    locked?: string;
    requested?: string;
    authorized?: string;
    unblinded?: string;
    stale?: string;
    analystAssigned?: string;
    analystError?: string;
    activationError?: string;
  }>;
};

function formatAuthorizationPolicy(policy: string) {
  return policy === "independent"
    ? "Independent authorization"
    : "Self-authorization permitted";
}

function getAnalystErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "account_not_found":
      return "No existing blindstats account was found for that email.";
    case "same_account":
      return "The blinded analyst must use a different authenticated account.";
    case "not_authorized":
      return "You do not have permission to assign a blinded analyst.";
    case "custodian_capabilities":
      return "Your account does not have the capabilities required to become the blinding custodian.";
    case "acknowledgement_required":
      return "Confirm the role separation before assigning the blinded analyst.";
    case "workflow_not_found":
      return "The blinding workflow could not be verified. Reload the page and try again.";
    case "workflow_not_setup":
      return "A blinded analyst can only be assigned while the workflow is in setup.";
    case "unable":
      return "The blinded analyst could not be assigned. Reload the workflow and try again.";
    default:
      return null;
  }
}

export default async function BlindingWorkflowPage({
  params,
  searchParams,
}: BlindingWorkflowPageProps) {
  const { studyId, workflowId } = await params;
  const {
    saved,
    activated,
    blinded,
    locked,
    requested,
    authorized,
    unblinded,
    stale,
    analystAssigned,
    analystError,
    activationError,
  } = await searchParams;
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
    { data: draft, error: draftError },
    { data: currentCapabilities, error: capabilitiesError },
    { data: unblindingCapabilities, error: unblindingCapabilitiesError },
  ] = await Promise.all([
    supabase
      .from("studies")
      .select("id, name")
      .eq("id", studyId)
      .maybeSingle(),
    supabase
      .from("blinding_workflows")
      .select(
        "id, study_id, state, active_plan_version_id, created_at, updated_at",
      )
      .eq("id", workflowId)
      .eq("study_id", studyId)
      .maybeSingle(),
    supabase
      .from("blinding_plan_drafts")
      .select(
        "workflow_id, study_id, protection_targets, protection_rationale, require_analysis_lock, authorization_policy, updated_at",
      )
      .eq("workflow_id", workflowId)
      .eq("study_id", studyId)
      .maybeSingle(),
    supabase
      .from("study_capabilities")
      .select("capability")
      .eq("study_id", studyId)
      .eq("user_id", currentUserId),
    supabase
      .from("study_capabilities")
      .select("user_id, capability")
      .eq("study_id", studyId)
      .in("capability", ["unblinding.request", "unblinding.authorize"]),
  ]);

  if (studyError) {
    throw new Error(`Unable to load Study: ${studyError.message}`);
  }

  if (workflowError) {
    throw new Error(
      `Unable to load blinding workflow: ${workflowError.message}`,
    );
  }

  if (draftError) {
    throw new Error(`Unable to load BlindingPlan draft: ${draftError.message}`);
  }

  if (capabilitiesError) {
    throw new Error(
      `Unable to load Study capabilities: ${capabilitiesError.message}`,
    );
  }

  if (unblindingCapabilitiesError) {
    throw new Error(
      `Unable to load unblinding capabilities: ${unblindingCapabilitiesError.message}`,
    );
  }

  if (!study || !workflow || !draft) {
    notFound();
  }

  let activePlan:
    | {
        id: string;
        version_number: number;
        protection_targets: string[];
        protection_rationale: string | null;
        require_analysis_lock: boolean;
        authorization_policy: string;
        warning_acknowledgements: string[];
        activated_at: string;
      }
    | null = null;

  if (workflow.active_plan_version_id) {
    const { data, error } = await supabase
      .from("blinding_plan_versions")
      .select(
        "id, version_number, protection_targets, protection_rationale, require_analysis_lock, authorization_policy, warning_acknowledgements, activated_at",
      )
      .eq("id", workflow.active_plan_version_id)
      .eq("workflow_id", workflow.id)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to load active BlindingPlan: ${error.message}`);
    }

    if (!data) {
      throw new Error("Active BlindingPlan version could not be loaded.");
    }

    activePlan = data;
  }

  let transformation:
    | {
        transformation_id: string;
        selected_column: string;
        source_artifact_sha256: string;
        blinded_artifact_sha256: string;
        public_receipt_sha256: string;
        receipt_created_at: string;
        registered_at: string;
        plan_version_id: string;
        public_receipt_text: string;
      }
    | null = null;

  if (workflow.state !== "setup") {
    const { data, error } = await supabase
      .from("blinding_transformations")
      .select(
        "transformation_id, selected_column, source_artifact_sha256, blinded_artifact_sha256, public_receipt_sha256, public_receipt_text, receipt_created_at, registered_at, plan_version_id",
      )
      .eq("workflow_id", workflow.id)
      .eq("study_id", study.id)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Unable to load registered blinding transformation: ${error.message}`,
      );
    }

    transformation = data;
  }

  let analysisLocks: {
    id: string;
    lock_id: string;
    receipt_created_at: string;
    analysis_artifact_filename: string;
    analysis_artifact_sha256: string;
    analysis_artifact_byte_length: number;
    analysis_lock_receipt_sha256: string;
    registered_at: string;
  }[] = [];

  if (transformation) {
    const { data, error } = await supabase
      .from("analysis_locks")
      .select(
        "id, lock_id, receipt_created_at, analysis_artifact_filename, analysis_artifact_sha256, analysis_artifact_byte_length, analysis_lock_receipt_sha256, registered_at",
      )
      .eq("workflow_id", workflow.id)
      .eq("study_id", study.id)
      .order("registered_at", { ascending: false });

    if (error) {
      throw new Error(`Unable to load analysis locks: ${error.message}`);
    }

    analysisLocks = data ?? [];
  }

  let unblindingRequest:
    | {
        id: string;
        analysis_lock_id: string | null;
        requested_by: string;
        requested_at: string;
      }
    | null = null;

  let unblindingAuthorization:
    | {
        id: string;
        authorization_policy: string;
        authorized_by: string;
        authorized_at: string;
      }
    | null = null;

  if (transformation) {
    const { data, error } = await supabase
      .from("unblinding_requests")
      .select("id, analysis_lock_id, requested_by, requested_at")
      .eq("workflow_id", workflow.id)
      .eq("study_id", study.id)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to load unblinding request: ${error.message}`);
    }

    unblindingRequest = data;
  }

  if (unblindingRequest) {
    const { data, error } = await supabase
      .from("unblinding_authorizations")
      .select("id, authorization_policy, authorized_by, authorized_at")
      .eq("request_id", unblindingRequest.id)
      .eq("workflow_id", workflow.id)
      .eq("study_id", study.id)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Unable to load unblinding authorization: ${error.message}`,
      );
    }

    unblindingAuthorization = data;
  }

  let authorizedAnalysisLock:
    | {
        id: string;
        lock_id: string;
        analysis_lock_receipt_sha256: string;
        analysis_lock_receipt_text: string;
      }
    | null = null;

  if (unblindingRequest?.analysis_lock_id) {
    const { data, error } = await supabase
      .from("analysis_locks")
      .select(
        "id, lock_id, analysis_lock_receipt_sha256, analysis_lock_receipt_text",
      )
      .eq("id", unblindingRequest.analysis_lock_id)
      .eq("workflow_id", workflow.id)
      .eq("study_id", study.id)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Unable to load request-selected AnalysisLock receipt: ${error.message}`,
      );
    }

    authorizedAnalysisLock = data;
  }

  let unblindingCompletion:
    | {
        id: string;
        unblinding_id: string;
        receipt_created_at: string;
        unblinding_secret_sha256: string;
        unblinding_receipt_sha256: string;
        completed_by: string;
        registered_at: string;
      }
    | null = null;

  if (unblindingRequest) {
    const { data, error } = await supabase
      .from("unblinding_completions")
      .select(
        "id, unblinding_id, receipt_created_at, unblinding_secret_sha256, unblinding_receipt_sha256, completed_by, registered_at",
      )
      .eq("request_id", unblindingRequest.id)
      .eq("workflow_id", workflow.id)
      .eq("study_id", study.id)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Unable to load unblinding completion: ${error.message}`,
      );
    }

    unblindingCompletion = data;
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
  const protectionTarget = draft.protection_targets[0] ?? "";
  const hasProtectionTarget = protectionTarget.trim().length > 0;
  const hasWeakerPolicy =
    !draft.require_analysis_lock ||
    draft.authorization_policy === "self_authorization";

  const unblindingRequesterIds = new Set(
    (unblindingCapabilities ?? [])
      .filter((entry) => entry.capability === "unblinding.request")
      .map((entry) => entry.user_id),
  );
  const unblindingAuthorizerIds = new Set(
    (unblindingCapabilities ?? [])
      .filter((entry) => entry.capability === "unblinding.authorize")
      .map((entry) => entry.user_id),
  );
  const hasIndependentAuthorizationPair = Array.from(
    unblindingRequesterIds,
  ).some((requesterId) =>
    Array.from(unblindingAuthorizerIds).some(
      (authorizerId) => authorizerId !== requesterId,
    ),
  );
  const independentAuthorizationReady =
    draft.authorization_policy !== "independent" ||
    hasIndependentAuthorizationPair;
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
      <Link
        className="text-sm font-medium text-black/60 underline underline-offset-4 dark:text-white/60"
        href={`/studies/${study.id}`}
      >
        Back to Study
      </Link>

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">Blinding workflow</h1>
          <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium capitalize text-black/60 dark:border-white/15 dark:text-white/60">
            {workflow.state.replaceAll("_", " ")}
          </span>
        </div>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          {study.name}
        </p>
        {isBlindedAnalyst ? (
          <p className="mt-2 text-sm font-medium">Role: Blinded analyst</p>
        ) : isBlindingCustodian ? (
          <p className="mt-2 text-sm font-medium">Role: Blinding custodian</p>
        ) : null}
      </header>

      {workflow.state === "setup" && canAssignBlindedAnalyst ? (
        <section className="mt-8 rounded-2xl border border-black/10 p-6 dark:border-white/15">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Analysis roles</h2>
            <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
              {isBlindingCustodian ? "Separated" : "Single-user"}
            </span>
          </div>

          {isBlindingCustodian ? (
            <p className="mt-3 text-sm text-black/60 dark:text-white/60">
              A separate blinded analyst is assigned. You are the blinding
              custodian.
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm text-black/60 dark:text-white/60">
                One account currently holds both blinding and analysis
                responsibilities.
              </p>

              {analystAssigned === "1" ? (
                <p className="mt-3 text-sm font-medium">
                  Blinded analyst assigned.
                </p>
              ) : null}

              {analystErrorMessage ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
                  <p className="text-sm font-medium">
                    Unable to assign blinded analyst
                  </p>
                  <p className="mt-1 text-sm">{analystErrorMessage}</p>
                </div>
              ) : null}

              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Use a separate blinded analyst
                </summary>
                <form action={assignBlindedAnalyst} className="mt-4 space-y-4">
                  <input type="hidden" name="studyId" value={study.id} />
                  <input type="hidden" name="workflowId" value={workflow.id} />

                  <div>
                    <label
                      className="text-sm font-medium"
                      htmlFor="analystEmail"
                    >
                      Analyst email
                    </label>
                    <input
                      autoComplete="off"
                      className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none placeholder:text-black/35 focus:border-black/40 dark:border-white/20 dark:placeholder:text-white/35 dark:focus:border-white/50"
                      id="analystEmail"
                      name="analystEmail"
                      placeholder="analyst@example.com"
                      required
                      type="email"
                    />
                    <p className="mt-1 text-xs text-black/45 dark:text-white/45">
                      Must already have a blindstats account.
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
                      I understand that this separates blinding and analysis
                      responsibilities for this Study.
                    </span>
                  </label>

                  <button
                    className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                    type="submit"
                  >
                    Assign blinded analyst
                  </button>
                </form>
              </details>
            </>
          )}
        </section>
      ) : null}

      {activePlan ? (
        <>
          {activated === "1" ? (
            <p className="mt-8 text-sm font-medium">
              BlindingPlan v{activePlan.version_number} activated.
            </p>
          ) : null}

          {stale === "1" ? (
            <div className="mt-8 rounded-xl border border-black/10 p-4 dark:border-white/15">
              <p className="text-sm font-medium">
                The draft was not changed.
              </p>
              <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                BlindingPlan v{activePlan.version_number} has already been
                activated, so the earlier draft is now read-only.
              </p>
            </div>
          ) : null}

          <section className="mt-8 rounded-2xl border border-black/10 p-6 dark:border-white/15">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h2 className="text-lg font-semibold">
                BlindingPlan v{activePlan.version_number}
              </h2>
              <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                Active
              </span>
            </div>

            <dl className="mt-5 grid gap-5 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                  Protection target
                </dt>
                <dd className="mt-1 text-sm">
                  {activePlan.protection_targets[0]}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                  Analysis lock
                </dt>
                <dd className="mt-1 text-sm">
                  {activePlan.require_analysis_lock ? "Required" : "Not required"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                  Authorization
                </dt>
                <dd className="mt-1 text-sm">
                  {formatAuthorizationPolicy(activePlan.authorization_policy)}
                </dd>
              </div>
            </dl>

            {activePlan.warning_acknowledgements.length > 0 ? (
              <div className="mt-5 rounded-xl border border-black/10 p-4 dark:border-white/15">
                <p className="text-sm font-medium">
                  Non-recommended settings acknowledged
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-black/60 dark:text-white/60">
                  {activePlan.warning_acknowledgements.includes(
                    "analysis_lock_not_required",
                  ) ? (
                    <li>Analysis lock is not required.</li>
                  ) : null}
                  {activePlan.warning_acknowledgements.includes(
                    "self_authorization_permitted",
                  ) ? (
                    <li>Self-authorization for unblinding is permitted.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            <details className="mt-5">
              <summary className="cursor-pointer text-sm font-medium">
                Plan details
              </summary>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                    Activated
                  </dt>
                  <dd className="mt-1 text-sm">
                    {new Date(activePlan.activated_at).toLocaleString("en-US")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                    Version status
                  </dt>
                  <dd className="mt-1 text-sm">Immutable</dd>
                </div>
              </dl>
              {activePlan.protection_rationale ? (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                    Protection rationale
                  </p>
                  <p className="mt-1 text-sm">
                    {activePlan.protection_rationale}
                  </p>
                </div>
              ) : null}
            </details>
          </section>

          {workflow.state === "setup" ? (
            <>
              <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <h2 className="text-lg font-semibold">Next step</h2>
                {canCreateBlinding ? (
                  <>
                    <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                      Create and register the blinded package below.
                    </p>
                    <p className="mt-2 text-sm font-medium">
                      After generation, keep the unblinding secret separate from analysis materials until unblinding is authorized.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                    Waiting for the blinding custodian to create and register the blinded package.
                  </p>
                )}
              </section>

              {canCreateBlinding ? (
                <BlindingWorkspace
                  registration={{
                    studyId: study.id,
                    workflowId: workflow.id,
                    planVersionNumber: activePlan.version_number,
                  }}
                  registerAction={registerBlindingTransformation}
                />
              ) : null}
            </>
          ) : transformation ? (
            <>
              <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Blinding registered</h2>
                    <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                      Blinded variable: <span className="font-medium text-foreground">{transformation.selected_column}</span>
                    </p>
                  </div>
                  <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                    Registered
                  </span>
                </div>

                {blinded === "1" ? (
                  <p className="mt-4 text-sm font-medium">
                    Blinded package recorded.
                  </p>
                ) : null}

                <details className="mt-5">
                  <summary className="cursor-pointer text-sm font-medium">
                    Technical details
                  </summary>
                  <p className="mt-3 text-sm text-black/60 dark:text-white/60">
                    The public receipt and safe transformation metadata are stored. Dataset contents and the unblinding secret are not.
                  </p>
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                        Transformation ID
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {transformation.transformation_id}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                        Source SHA-256
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {transformation.source_artifact_sha256}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                        Blinded SHA-256
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {transformation.blinded_artifact_sha256}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                        Public receipt SHA-256
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs">
                        {transformation.public_receipt_sha256}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                        Registered
                      </dt>
                      <dd className="mt-1 text-sm">
                        {new Date(transformation.registered_at).toLocaleString("en-US")}
                      </dd>
                    </div>
                  </dl>
                </details>
              </section>

              {workflow.state === "blinded" && !unblindingRequest ? (
                <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                  <h2 className="text-lg font-semibold">Next step</h2>
                  {analysisLocks.length === 0 ? (
                    isBlindingCustodian ? (
                      <>
                        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                          Send the blinded dataset to the blinded analyst, then wait for the analyst to register an AnalysisLock.
                        </p>
                        <p className="mt-2 text-sm font-medium">
                          Keep the unblinding secret until unblinding is authorized.
                        </p>
                      </>
                    ) : isBlindedAnalyst ? (
                      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                        Analyze the blinded dataset supplied by the custodian, then register an AnalysisLock below.
                      </p>
                    ) : canCreateBlinding && canLockAnalysis ? (
                      <>
                        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                          Complete the blinded analysis, then register an AnalysisLock below.
                        </p>
                        <p className="mt-2 text-sm font-medium">
                          Keep the unblinding secret separate from analysis materials until unblinding is authorized.
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                        Waiting for an AnalysisLock to be registered.
                      </p>
                    )
                  ) : canRequestUnblinding ? (
                    <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                      Request unblinding below using the appropriate registered AnalysisLock.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                      Waiting for the blinded analyst to request unblinding.
                    </p>
                  )}
                </section>
              ) : null}

              <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Analysis locks</h2>
                  <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                    {analysisLocks.length}
                  </span>
                </div>
                <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
                  Locks preserve exact analysis-artifact identity without storing the artifact contents.
                </p>

                {locked === "1" ? (
                  <p className="mt-4 text-sm font-medium">Analysis lock recorded.</p>
                ) : null}

                {analysisLocks.length === 0 ? (
                  <p className="mt-4 text-sm text-black/60 dark:text-white/60">
                    No analysis lock has been registered yet.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {analysisLocks.map((lock, index) => (
                      <details
                        className="rounded-xl border border-black/10 p-4 dark:border-white/15"
                        key={lock.id}
                      >
                        <summary className="cursor-pointer text-sm font-medium">
                          Analysis lock {analysisLocks.length - index}: {lock.analysis_artifact_filename}
                        </summary>
                        <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                          Registered {new Date(lock.registered_at).toLocaleString("en-US")}
                        </p>
                        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                              Analysis SHA-256
                            </dt>
                            <dd className="mt-1 break-all font-mono text-xs">
                              {lock.analysis_artifact_sha256}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                              Lock receipt SHA-256
                            </dt>
                            <dd className="mt-1 break-all font-mono text-xs">
                              {lock.analysis_lock_receipt_sha256}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                              Lock ID
                            </dt>
                            <dd className="mt-1 break-all font-mono text-xs">
                              {lock.lock_id}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                              Byte length
                            </dt>
                            <dd className="mt-1 text-sm">
                              {lock.analysis_artifact_byte_length.toLocaleString()}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                              Receipt created
                            </dt>
                            <dd className="mt-1 text-sm">
                              {new Date(lock.receipt_created_at).toLocaleString("en-US")}
                            </dd>
                          </div>
                        </dl>
                      </details>
                    ))}
                  </div>
                )}
              </section>

              <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Unblinding</h2>
                    <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
                      Request → authorization → local release. Authorization alone does not expose the protected mapping.
                    </p>
                  </div>
                  <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                    {unblindingCompletion
                      ? "Unblinded"
                      : unblindingAuthorization
                        ? "Authorized"
                        : unblindingRequest
                          ? "Requested"
                          : "Not requested"}
                  </span>
                </div>

                {requested === "1" ? (
                  <p className="mt-4 text-sm font-medium">Request recorded.</p>
                ) : null}

                {authorized === "1" ? (
                  <p className="mt-4 text-sm font-medium">Authorization recorded.</p>
                ) : null}

                {unblinded === "1" ? (
                  <p className="mt-4 text-sm font-medium">Unblinding recorded.</p>
                ) : null}

                {unblindingAuthorization && !unblindingCompletion ? (
                  <p className="mt-4 text-sm font-medium">
                    Authorized. The protected mapping has not been released yet.
                  </p>
                ) : null}

                {unblindingCompletion ? (
                  <p className="mt-4 text-sm font-medium">
                    Authorized unblinding is complete.
                  </p>
                ) : null}

                {!unblindingRequest && workflow.state === "blinded" ? (
                  <div className="mt-6">
                    {activePlan.require_analysis_lock &&
                    analysisLocks.length === 0 ? (
                      <div className="rounded-xl border border-black/10 p-4 dark:border-white/15">
                        <p className="text-sm font-medium">
                          Analysis lock required before unblinding
                        </p>
                        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                          Register at least one AnalysisLock before requesting unblinding.
                        </p>
                      </div>
                    ) : canRequestUnblinding ? (
                      <form action={requestUnblinding} className="space-y-4">
                        <input type="hidden" name="studyId" value={study.id} />
                        <input
                          type="hidden"
                          name="workflowId"
                          value={workflow.id}
                        />

                        <div>
                          <label
                            className="text-sm font-medium"
                            htmlFor="analysisLockId"
                          >
                            Analysis lock for unblinding
                          </label>
                          <select
                            className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
                            defaultValue=""
                            id="analysisLockId"
                            name="analysisLockId"
                            required={activePlan.require_analysis_lock}
                          >
                            <option value="">
                              {activePlan.require_analysis_lock
                                ? "Select a registered AnalysisLock"
                                : "No AnalysisLock"}
                            </option>
                            {analysisLocks.map((lock, index) => (
                              <option key={lock.id} value={lock.id}>
                                Analysis lock {analysisLocks.length - index}: {lock.analysis_artifact_filename}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                            {activePlan.require_analysis_lock
                              ? "The request will be permanently bound to the selected lock."
                              : "A lock is optional under this Plan."}
                          </p>
                        </div>

                        <button
                          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                          type="submit"
                        >
                          Request unblinding
                        </button>
                      </form>
                    ) : (
                      <p className="text-sm text-black/60 dark:text-white/60">
                        Waiting for a Study member who can request unblinding.
                      </p>
                    )}
                  </div>
                ) : null}

                {unblindingRequest && !unblindingAuthorization ? (
                  <div className="mt-6 rounded-xl border border-black/10 p-4 dark:border-white/15">
                    {activePlan.authorization_policy === "independent" &&
                    unblindingRequest.requested_by === currentUserId ? (
                      <>
                        <p className="text-sm font-medium">
                          Awaiting independent authorization
                        </p>
                        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                          A different Study member must authorize this request.
                        </p>
                      </>
                    ) : canAuthorizeUnblinding ? (
                      <>
                        <p className="text-sm font-medium">
                          Authorization required
                        </p>
                        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                          {activePlan.authorization_policy === "independent"
                            ? "This request was made by another Study member."
                            : "This Plan permits self-authorization."}
                        </p>
                        <form action={authorizeUnblinding} className="mt-4">
                          <input
                            type="hidden"
                            name="studyId"
                            value={study.id}
                          />
                          <input
                            type="hidden"
                            name="workflowId"
                            value={workflow.id}
                          />
                          <input
                            type="hidden"
                            name="requestId"
                            value={unblindingRequest.id}
                          />
                          <button
                            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                            type="submit"
                          >
                            Authorize unblinding
                          </button>
                        </form>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium">Awaiting authorization</p>
                        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                          Another authorized Study member must complete this step.
                        </p>
                      </>
                    )}
                  </div>
                ) : null}

                {unblindingRequest ||
                unblindingAuthorization ||
                unblindingCompletion ? (
                  <details className="mt-6 rounded-xl border border-black/10 p-4 dark:border-white/15">
                    <summary className="cursor-pointer text-sm font-medium">
                      Unblinding history
                    </summary>

                    <div className="mt-4 space-y-5">
                      {unblindingRequest ? (
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm font-medium">Request</p>
                            <span className="text-xs text-black/50 dark:text-white/50">
                              {new Date(
                                unblindingRequest.requested_at,
                              ).toLocaleString("en-US")}
                            </span>
                          </div>
                          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Requested by
                              </dt>
                              <dd className="mt-1 text-sm">
                                {unblindingRequest.requested_by === currentUserId
                                  ? "You"
                                  : "Another Study member"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Request ID
                              </dt>
                              <dd className="mt-1 break-all font-mono text-xs">
                                {unblindingRequest.id}
                              </dd>
                            </div>
                            <div className="sm:col-span-2">
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Analysis lock
                              </dt>
                              <dd className="mt-1 text-sm">
                                {unblindingRequest.analysis_lock_id
                                  ? (() => {
                                      const selectedLockIndex = analysisLocks.findIndex(
                                        (lock) =>
                                          lock.id ===
                                          unblindingRequest.analysis_lock_id,
                                      );
                                      const selectedLock =
                                        selectedLockIndex >= 0
                                          ? analysisLocks[selectedLockIndex]
                                          : null;

                                      return selectedLock
                                        ? `Analysis lock ${analysisLocks.length - selectedLockIndex}: ${selectedLock.analysis_artifact_filename}`
                                        : "Registered analysis lock";
                                    })()
                                  : "No AnalysisLock selected"}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      ) : null}

                      {unblindingAuthorization ? (
                        <div className="border-t border-black/10 pt-5 dark:border-white/15">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm font-medium">Authorization</p>
                            <span className="text-xs text-black/50 dark:text-white/50">
                              {new Date(
                                unblindingAuthorization.authorized_at,
                              ).toLocaleString("en-US")}
                            </span>
                          </div>
                          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Policy
                              </dt>
                              <dd className="mt-1 text-sm">
                                {formatAuthorizationPolicy(
                                  unblindingAuthorization.authorization_policy,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Authorized by
                              </dt>
                              <dd className="mt-1 text-sm">
                                {unblindingAuthorization.authorized_by === currentUserId
                                  ? "You"
                                  : "Another Study member"}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      ) : null}

                      {unblindingCompletion ? (
                        <div className="border-t border-black/10 pt-5 dark:border-white/15">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm font-medium">Completion</p>
                            <span className="text-xs text-black/50 dark:text-white/50">
                              {new Date(
                                unblindingCompletion.registered_at,
                              ).toLocaleString("en-US")}
                            </span>
                          </div>
                          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Completed by
                              </dt>
                              <dd className="mt-1 text-sm">
                                {unblindingCompletion.completed_by === currentUserId
                                  ? "You"
                                  : "Another Study member"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Receipt created
                              </dt>
                              <dd className="mt-1 text-sm">
                                {new Date(
                                  unblindingCompletion.receipt_created_at,
                                ).toLocaleString("en-US")}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Unblinding ID
                              </dt>
                              <dd className="mt-1 break-all font-mono text-xs">
                                {unblindingCompletion.unblinding_id}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Receipt SHA-256
                              </dt>
                              <dd className="mt-1 break-all font-mono text-xs">
                                {unblindingCompletion.unblinding_receipt_sha256}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Secret SHA-256
                              </dt>
                              <dd className="mt-1 break-all font-mono text-xs">
                                {unblindingCompletion.unblinding_secret_sha256}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                                Trusted registration time
                              </dt>
                              <dd className="mt-1 text-sm">
                                {new Date(
                                  unblindingCompletion.registered_at,
                                ).toLocaleString("en-US")}
                              </dd>
                            </div>
                          </dl>
                          <p className="mt-3 text-xs text-black/50 dark:text-white/50">
                            The secret, plaintext mapping, and final receipt text were not uploaded.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </section>

              {workflow.state === "unblinding_authorized" &&
              unblindingRequest &&
              unblindingAuthorization &&
              !unblindingCompletion ? (
                canReceiveUnblinded ? (
                  authorizedAnalysisLock ? (
                    <>
                      <UnblindingWorkspace
                        registration={{
                          studyId: study.id,
                          workflowId: workflow.id,
                          requestId: unblindingRequest.id,
                          transformationId: transformation.transformation_id,
                          publicReceiptSha256:
                            transformation.public_receipt_sha256,
                          publicReceiptBase64: Buffer.from(
                            transformation.public_receipt_text,
                            "utf8",
                          ).toString("base64"),
                          lockId: authorizedAnalysisLock.lock_id,
                          analysisLockReceiptSha256:
                            authorizedAnalysisLock.analysis_lock_receipt_sha256,
                          analysisLockReceiptBase64: Buffer.from(
                            authorizedAnalysisLock.analysis_lock_receipt_text,
                            "utf8",
                          ).toString("base64"),
                        }}
                        registerAction={registerUnblindingCompletion}
                      />
                    </>
                  ) : (
                    <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                      <h2 className="text-lg font-semibold">
                        Documented unblinding
                      </h2>
                      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                        This first persistent completion path requires the
                        authorized request to be bound to a registered
                        AnalysisLock.
                      </p>
                    </section>
                  )
                ) : (
                  <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                    <h2 className="text-lg font-semibold">Secret handoff</h2>
                    <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
                      {isBlindingCustodian || canAuthorizeUnblinding
                        ? "Send the saved unblinding secret to the blinded analyst through the approved secure file-transfer channel. Do not upload the secret to blindstats."
                        : "Waiting for the authorized recipient to complete local unblinding."}
                    </p>
                  </section>
                )
              ) : null}

              {workflow.state === "blinded" && !unblindingRequest ? (
                canLockAnalysis ? (
                  analysisLocks.length === 0 ? (
                    <AnalysisLockWorkspace
                      registration={{
                        studyId: study.id,
                        workflowId: workflow.id,
                        transformationId: transformation.transformation_id,
                        publicReceiptSha256: transformation.public_receipt_sha256,
                        publicReceiptBase64: Buffer.from(
                          transformation.public_receipt_text,
                          "utf8",
                        ).toString("base64"),
                      }}
                      registerAction={registerAnalysisLock}
                    />
                  ) : (
                    <details className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                      <summary className="cursor-pointer text-sm font-semibold">
                        Create another analysis lock
                      </summary>
                      <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
                        Create an additional immutable lock for another exact
                        analysis artifact. Existing registered locks remain
                        unchanged.
                      </p>

                      <AnalysisLockWorkspace
                        registration={{
                          studyId: study.id,
                          workflowId: workflow.id,
                          transformationId: transformation.transformation_id,
                          publicReceiptSha256: transformation.public_receipt_sha256,
                          publicReceiptBase64: Buffer.from(
                            transformation.public_receipt_text,
                            "utf8",
                          ).toString("base64"),
                        }}
                        registerAction={registerAnalysisLock}
                      />
                    </details>
                  )
                ) : null
              ) : null}
            </>
          ) : (
            <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
              <h2 className="text-lg font-semibold">Blinding workflow</h2>
              <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                This workflow is no longer in setup, but no registered blinding
                transformation is available to display.
              </p>
            </section>
          )}
        </>
      ) : canConfigureBlinding ? (
        <section className="mt-10 rounded-2xl border border-black/10 p-6 dark:border-white/15">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Blinding plan</h2>
            <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
              Draft
            </span>
          </div>

          {saved === "1" ? (
            <p className="mt-3 text-sm font-medium">Draft saved.</p>
          ) : null}

          {activationError === "independent_requires_two_actors" ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <p className="text-sm font-medium">Plan not activated</p>
              <p className="mt-1 text-sm">
                Independent authorization requires two different Study members:
                one who can request unblinding and another who can authorize it.
              </p>
            </div>
          ) : null}

          <form action={saveBlindingPlanDraft} className="mt-5 space-y-5">
            <input type="hidden" name="studyId" value={study.id} />
            <input type="hidden" name="workflowId" value={workflow.id} />

            <div>
              <label
                className="text-sm font-medium"
                htmlFor="protectionTarget"
              >
                Protection target
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
                defaultValue={protectionTarget}
                id="protectionTarget"
                maxLength={200}
                name="protectionTarget"
                placeholder="Treatment identity"
                type="text"
              />
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                What substantive information should the analyst not know?
              </p>
            </div>

            <details open={Boolean(draft.protection_rationale)}>
              <summary className="cursor-pointer text-sm font-medium">
                Protection rationale <span className="font-normal text-black/45 dark:text-white/45">(optional)</span>
              </summary>
              <textarea
                className="mt-3 min-h-24 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
                defaultValue={draft.protection_rationale ?? ""}
                id="protectionRationale"
                maxLength={1000}
                name="protectionRationale"
                placeholder="Briefly explain why this information is being blinded."
              />
            </details>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium" htmlFor="lockPolicy">
                  Analysis lock
                </label>
                <select
                  className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
                  defaultValue={
                    draft.require_analysis_lock ? "required" : "not_required"
                  }
                  id="lockPolicy"
                  name="lockPolicy"
                >
                  <option value="required">Required (recommended)</option>
                  <option value="not_required">Not required</option>
                </select>
              </div>

              <div>
                <label
                  className="text-sm font-medium"
                  htmlFor="authorizationPolicy"
                >
                  Unblinding authorization
                </label>
                <select
                  className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
                  defaultValue={draft.authorization_policy}
                  id="authorizationPolicy"
                  name="authorizationPolicy"
                >
                  <option value="independent">
                    Independent (recommended)
                  </option>
                  <option value="self_authorization">
                    Self-authorization permitted
                  </option>
                </select>
                {draft.authorization_policy === "independent" &&
                !hasIndependentAuthorizationPair ? (
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                    Independent authorization needs two different Study members:
                    one who can request unblinding and another who can authorize it.
                    Assign a separate blinded analyst above, or choose self-authorization
                    and save the draft.
                  </p>
                ) : null}
              </div>
            </div>

            <button
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              type="submit"
            >
              Save draft
            </button>
          </form>

          <div className="mt-7 border-t border-black/10 pt-6 dark:border-white/15">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Plan status</h3>
              <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                {!hasProtectionTarget
                  ? "Needs protection target"
                  : !independentAuthorizationReady
                    ? "Needs second actor"
                    : "Ready to activate"}
              </span>
            </div>

            {!hasProtectionTarget ? (
              <p className="mt-3 text-sm text-black/60 dark:text-white/60">
                Add a protection target and save the draft.
              </p>
            ) : !independentAuthorizationReady ? (
              <p className="mt-3 text-sm text-black/60 dark:text-white/60">
                The saved Plan requires independent authorization, but no two different Study members currently hold the request and authorization roles. Assign a separate blinded analyst above, or choose self-authorization and save the draft.
              </p>
            ) : (
              <>
                <p className="mt-3 text-sm font-medium">
                  Activating Plan v1 makes this saved plan immutable.
                </p>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  Save any changes above before activating. Activation does not create the blinded dataset.
                </p>

                <form action={activateBlindingPlan} className="mt-4">
                  <input type="hidden" name="studyId" value={study.id} />
                  <input type="hidden" name="workflowId" value={workflow.id} />

                  {hasWeakerPolicy ? (
                    <label className="flex max-w-3xl items-start gap-3 text-sm">
                      <input
                        className="mt-1"
                        name="acknowledgeWeakerPolicies"
                        type="checkbox"
                        required
                      />
                      <span>
                        I understand that this plan uses one or more
                        non-recommended governance settings and want to activate
                        it as specified.
                      </span>
                    </label>
                  ) : null}

                  <button
                    className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                    type="submit"
                  >
                    Activate Plan v1
                  </button>
                </form>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="mt-10 rounded-2xl border border-black/10 p-6 dark:border-white/15">
          <h2 className="text-lg font-semibold">BlindingPlan setup</h2>
          <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
            The blinding custodian is responsible for configuring and activating
            the Study&apos;s BlindingPlan. Your current Study role is read-only during
            setup.
          </p>
        </section>

      )}
    </main>
  );
}

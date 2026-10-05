import { Buffer } from "node:buffer";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AnalysisLockWorkspace } from "@/components/blinding/AnalysisLockWorkspace";
import { AuthorizationPolicyField } from "@/components/blinding/AuthorizationPolicyField";
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
    view?: string;
  }>;
};

function formatAuthorizationPolicy(policy: string) {
  return policy === "independent"
    ? "Independent authorization"
    : "Self-authorization permitted";
}

function formatWorkflowState(state: string) {
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
      return state
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
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
    stale,
    analystError,
    activationError,
    view,
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
  if (workflow.state === "setup") {
    type SetupView = "roles" | "plan" | "blinding";

    const requestedSetupView: SetupView | null =
      view === "roles" || view === "plan" || view === "blinding"
        ? view
        : null;

    const roleSeparationRequired =
      (activePlan?.authorization_policy ?? draft.authorization_policy) ===
        "independent" &&
      (Boolean(activePlan) || hasProtectionTarget);

    const recommendedSetupView: SetupView = activePlan
      ? "blinding"
      : analystError
        ? "roles"
        : roleSeparationRequired && !hasIndependentAuthorizationPair
          ? "roles"
          : "plan";

    const requestedSetupViewIsAvailable =
      requestedSetupView === "plan" ||
      (requestedSetupView === "roles" && roleSeparationRequired) ||
      (requestedSetupView === "blinding" && Boolean(activePlan));

    const setupView: SetupView =
      requestedSetupView && requestedSetupViewIsAvailable
        ? requestedSetupView
        : recommendedSetupView;

    const workflowHref = `/studies/${study.id}/blinding/${workflow.id}`;

    const setupNavItems: {
      id: SetupView;
      label: string;
      status: string;
      available: boolean;
    }[] = [
      {
        id: "plan",
        label: "Blinding plan",
        status: activePlan
          ? "Active"
          : !hasProtectionTarget
            ? "Draft"
            : roleSeparationRequired && !hasIndependentAuthorizationPair
              ? "Needs roles"
              : "Ready",
        available: true,
      },
    ];

    if (roleSeparationRequired) {
      setupNavItems.push({
        id: "roles",
        label: "Analysis roles",
        status: hasIndependentAuthorizationPair ? "Separated" : "Required",
        available: true,
      });
    }

    setupNavItems.push({
      id: "blinding",
      label: "Blinded package",
      status: activePlan ? "Ready" : "Locked",
      available: Boolean(activePlan),
    });

    return (
      <main className="mx-auto min-h-screen w-full max-w-7xl px-6 py-10">
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
              Setup
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

        <div className="mt-8 grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <nav
              aria-label="Blinding workflow sections"
              className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0"
            >
              {setupNavItems.map((item) => {
                const isActive = setupView === item.id;

                if (!item.available) {
                  return (
                    <div
                      className="min-w-40 rounded-xl border border-black/10 px-4 py-3 opacity-45 dark:border-white/15 lg:min-w-0"
                      key={item.id}
                    >
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="mt-1 text-xs text-black/50 dark:text-white/50">
                        {item.status}
                      </div>
                    </div>
                  );
                }

                return (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={`min-w-40 rounded-xl border px-4 py-3 transition lg:min-w-0 ${
                      isActive
                        ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                        : "border-black/10 hover:border-black/30 dark:border-white/15 dark:hover:border-white/35"
                    }`}
                    href={`${workflowHref}?view=${item.id}`}
                    key={item.id}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    <div
                      className={`mt-1 text-xs ${
                        isActive
                          ? "text-white/70 dark:text-black/60"
                          : "text-black/50 dark:text-white/50"
                      }`}
                    >
                      {item.status}
                    </div>
                  </Link>
                );
              })}
            </nav>
          </aside>

          <div className="min-w-0">
            {setupView === "roles" && roleSeparationRequired ? (
              <section className="rounded-2xl border border-black/10 p-6 dark:border-white/15 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">Analysis roles</h2>
                    <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                      Independent authorization requires a separate blinded
                      analyst.
                    </p>
                  </div>
                  <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                    {hasIndependentAuthorizationPair ? "Separated" : "Required"}
                  </span>
                </div>

                {hasIndependentAuthorizationPair ? (
                  <p className="mt-5 text-sm text-black/60 dark:text-white/60">
                    A separate blinded analyst is assigned.
                    {isBlindingCustodian
                      ? " You are the blinding custodian."
                      : isBlindedAnalyst
                        ? " You are the blinded analyst."
                        : ""}
                  </p>
                ) : canAssignBlindedAnalyst ? (
                  <>
                    {analystErrorMessage ? (
                      <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
                        <p className="text-sm font-medium">
                          Unable to assign blinded analyst
                        </p>
                        <p className="mt-1 text-sm">{analystErrorMessage}</p>
                      </div>
                    ) : null}

                    <form
                      action={assignBlindedAnalyst}
                      className="mt-5 space-y-4"
                    >
                      <input type="hidden" name="studyId" value={study.id} />
                      <input
                        type="hidden"
                        name="workflowId"
                        value={workflow.id}
                      />

                      <div>
                        <label
                          className="text-sm font-medium"
                          htmlFor="analystEmail"
                        >
                          Blinded analyst email
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
                          The analyst must already have a blindstats account.
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
                  </>
                ) : isBlindedAnalyst ? (
                  <p className="mt-5 text-sm text-black/60 dark:text-white/60">
                    You are assigned as the blinded analyst. The blinding
                    custodian manages role separation.
                  </p>
                ) : (
                  <p className="mt-5 text-sm text-black/60 dark:text-white/60">
                    Your current study role cannot change analysis-role
                    assignments.
                  </p>
                )}
              </section>
            ) : null}

            {setupView === "plan" ? (
              activePlan ? (
                <section className="rounded-2xl border border-black/10 p-6 dark:border-white/15 sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold">
                        Blinding plan v{activePlan.version_number}
                      </h2>
                      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                        This plan is active and immutable.
                      </p>
                    </div>
                    <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                      Active
                    </span>
                  </div>

                  {stale === "1" ? (
                    <p className="mt-5 text-sm font-medium">
                      The draft was not changed because this plan is already
                      active.
                    </p>
                  ) : null}

                  <dl className="mt-6 grid gap-5 sm:grid-cols-3">
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
                        {activePlan.require_analysis_lock
                          ? "Required"
                          : "Not required"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                        Authorization
                      </dt>
                      <dd className="mt-1 text-sm">
                        {formatAuthorizationPolicy(
                          activePlan.authorization_policy,
                        )}
                      </dd>
                    </div>
                  </dl>

                  {activePlan.warning_acknowledgements.length > 0 ? (
                    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                      <p className="text-sm font-medium">
                        Non-recommended settings were acknowledged
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
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

                  <details className="mt-6">
                    <summary className="cursor-pointer text-sm font-medium">
                      Plan details
                    </summary>
                    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                          Activated
                        </dt>
                        <dd className="mt-1 text-sm">
                          {new Date(activePlan.activated_at).toLocaleString(
                            "en-US",
                          )}
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
              ) : canConfigureBlinding ? (
                <section className="rounded-2xl border border-black/10 p-6 dark:border-white/15 sm:p-8">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">Blinding plan</h2>
                      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                        Define the protection and governance rules for this
                        workflow.
                      </p>
                    </div>
                    <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                      Draft
                    </span>
                  </div>

                  {saved === "1" ? (
                    <p className="mt-4 text-sm font-medium">Draft saved.</p>
                  ) : null}

                  {activationError === "independent_requires_two_actors" ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                      <p className="text-sm font-medium">Plan not activated</p>
                      <p className="mt-1 text-sm">
                        Independent authorization requires two different Study
                        members: one who can request unblinding and another who
                        can authorize it.
                      </p>
                    </div>
                  ) : null}

                  <form
                    action={saveBlindingPlanDraft}
                    className="mt-6 space-y-5"
                  >
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
                        Protection rationale{" "}
                        <span className="font-normal text-black/45 dark:text-white/45">
                          (optional)
                        </span>
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
                        <label
                          className="text-sm font-medium"
                          htmlFor="lockPolicy"
                        >
                          Analysis lock
                        </label>
                        <select
                          className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
                          defaultValue={
                            draft.require_analysis_lock
                              ? "required"
                              : "not_required"
                          }
                          id="lockPolicy"
                          name="lockPolicy"
                        >
                          <option value="required">
                            Required (recommended)
                          </option>
                          <option value="not_required">Not required</option>
                        </select>
                      </div>

                      <AuthorizationPolicyField
                        initialPolicy={draft.authorization_policy}
                      />
                    </div>

                    <button
                      className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                      type="submit"
                    >
                      Save draft
                    </button>
                  </form>

                  <div className="mt-7 border-t border-black/10 pt-6 dark:border-white/15">
                    {!hasProtectionTarget ? (
                      <p className="text-sm text-black/60 dark:text-white/60">
                        Save a protection target before activating the plan.
                      </p>
                    ) : roleSeparationRequired &&
                      !hasIndependentAuthorizationPair ? (
                      <div>
                        <p className="text-sm font-medium">
                          Analysis roles are required before activation.
                        </p>
                        <Link
                          className="mt-2 inline-block text-sm font-medium underline underline-offset-4"
                          href={`${workflowHref}?view=roles`}
                        >
                          Continue to Analysis roles
                        </Link>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium">
                          Activating plan v1 makes this saved plan immutable.
                        </p>

                        <form
                          action={activateBlindingPlan}
                          className="mt-4"
                        >
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
                                non-recommended governance settings and want to
                                activate it as specified.
                              </span>
                            </label>
                          ) : null}

                          <button
                            className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                            type="submit"
                          >
                            Activate plan v1
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                </section>
              ) : (
                <section className="rounded-2xl border border-black/10 p-6 dark:border-white/15 sm:p-8">
                  <h2 className="text-xl font-semibold">Blinding plan</h2>
                  <p className="mt-3 text-sm text-black/60 dark:text-white/60">
                    The blinding custodian is responsible for configuring and
                    activating this study&apos;s blinding plan. Your current role
                    is read-only during setup.
                  </p>
                </section>
              )
            ) : null}

            {setupView === "blinding" && activePlan ? (
              <section>
                <div className="mb-6">
                  <div>
                    <h2 className="text-xl font-semibold">
                      Create blinded package
                    </h2>
                    <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                      Generate the blinded dataset and register its safe metadata.
                    </p>
                  </div>
                </div>

                {canCreateBlinding ? (
                  <BlindingWorkspace
                    registration={{
                      studyId: study.id,
                      workflowId: workflow.id,
                      planVersionNumber: activePlan.version_number,
                    }}
                    registerAction={registerBlindingTransformation}
                  />
                ) : (
                  <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
                    <p className="text-sm text-black/60 dark:text-white/60">
                      Waiting for the blinding custodian to create and register
                      the blinded package.
                    </p>
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  if (!activePlan || !transformation) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-12">
        <Link
          className="text-sm font-medium text-black/60 underline underline-offset-4 dark:text-white/60"
          href={`/studies/${study.id}`}
        >
          Back to Study
        </Link>

        <section className="mt-10 rounded-2xl border border-black/10 p-6 dark:border-white/15">
          <h1 className="text-xl font-semibold">Blinding workflow</h1>
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">
            The workflow is no longer in setup, but its active plan or registered blinding transformation could not be loaded.
          </p>
        </section>
      </main>
    );
  }

  type PostSetupView =
    | "roles"
    | "plan"
    | "blinding"
    | "analysis"
    | "unblinding"
    | "history";

  const workflowHref = `/studies/${study.id}/blinding/${workflow.id}`;
  const roleSeparationUsed = activePlan.authorization_policy === "independent";
  const analysisLockSatisfied =
    !activePlan.require_analysis_lock || analysisLocks.length > 0;
  const unblindingUnlocked = analysisLockSatisfied;

  const recommendedPostSetupView: PostSetupView = unblindingCompletion
    ? "unblinding"
    : unblindingAuthorization || unblindingRequest
      ? "unblinding"
      : activePlan.require_analysis_lock && analysisLocks.length === 0
        ? "analysis"
        : "unblinding";

  const requestedPostSetupView: PostSetupView | null =
    view === "roles" ||
    view === "plan" ||
    view === "blinding" ||
    view === "analysis" ||
    view === "unblinding" ||
    view === "history"
      ? view
      : null;

  const requestedPostSetupViewIsAvailable =
    requestedPostSetupView === "plan" ||
    requestedPostSetupView === "blinding" ||
    requestedPostSetupView === "analysis" ||
    requestedPostSetupView === "history" ||
    (requestedPostSetupView === "roles" && roleSeparationUsed) ||
    (requestedPostSetupView === "unblinding" && unblindingUnlocked);

  const postSetupView: PostSetupView =
    requestedPostSetupView && requestedPostSetupViewIsAvailable
      ? requestedPostSetupView
      : recommendedPostSetupView;

  const analysisStatus = activePlan.require_analysis_lock
    ? analysisLocks.length > 0
      ? "Locked"
      : "Required"
    : analysisLocks.length > 0
      ? "Locked"
      : "Optional";

  const unblindingStatus = unblindingCompletion
    ? "Complete"
    : unblindingAuthorization
      ? "Authorized"
      : unblindingRequest
        ? "Requested"
        : unblindingUnlocked
          ? "Ready"
          : "Locked";

  const postSetupNavItems: {
    id: PostSetupView;
    label: string;
    status: string;
    available: boolean;
  }[] = [
    {
      id: "plan",
      label: "Blinding plan",
      status: "Active",
      available: true,
    },
  ];

  if (roleSeparationUsed) {
    postSetupNavItems.push({
      id: "roles",
      label: "Analysis roles",
      status: "Separated",
      available: true,
    });
  }

  postSetupNavItems.push(
    {
      id: "blinding",
      label: "Blinded package",
      status: "Registered",
      available: true,
    },
    {
      id: "analysis",
      label: "Analysis lock",
      status: analysisStatus,
      available: true,
    },
    {
      id: "unblinding",
      label: "Unblinding",
      status: unblindingStatus,
      available: unblindingUnlocked,
    },
    {
      id: "history",
      label: "Audit history",
      status: "Available",
      available: true,
    },
  );

  const selectedRequestLockIndex = unblindingRequest?.analysis_lock_id
    ? analysisLocks.findIndex(
        (lock) => lock.id === unblindingRequest.analysis_lock_id,
      )
    : -1;
  const selectedRequestLock =
    selectedRequestLockIndex >= 0 ? analysisLocks[selectedRequestLockIndex] : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-6 py-10">
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
            {formatWorkflowState(workflow.state)}
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

      <div className="mt-8 grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <nav
            aria-label="Blinding workflow sections"
            className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {postSetupNavItems.map((item) => {
              const isActive = postSetupView === item.id;

              if (!item.available) {
                return (
                  <div
                    className="min-w-40 rounded-xl border border-black/10 px-4 py-3 opacity-45 dark:border-white/15 lg:min-w-0"
                    key={item.id}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="mt-1 text-xs text-black/50 dark:text-white/50">
                      {item.status}
                    </div>
                  </div>
                );
              }

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`min-w-40 rounded-xl border px-4 py-3 transition lg:min-w-0 ${
                    isActive
                      ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-black/10 hover:border-black/30 dark:border-white/15 dark:hover:border-white/35"
                  }`}
                  href={`${workflowHref}?view=${item.id}`}
                  key={item.id}
                >
                  <div className="text-sm font-medium">{item.label}</div>
                  <div
                    className={`mt-1 text-xs ${
                      isActive
                        ? "text-white/70 dark:text-black/60"
                        : "text-black/50 dark:text-white/50"
                    }`}
                  >
                    {item.status}
                  </div>
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0">
          {postSetupView === "plan" ? (
            <section className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">
                    Blinding plan v{activePlan.version_number}
                  </h2>
                  <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                    This plan is active and immutable.
                  </p>
                </div>
                <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                  Active
                </span>
              </div>

              <dl className="mt-6 grid gap-5 sm:grid-cols-3">
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
                <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                  <p className="text-sm font-medium">
                    Non-recommended settings were acknowledged at activation.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
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

              <details className="mt-6">
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
          ) : null}

          {postSetupView === "roles" && roleSeparationUsed ? (
            <section className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">Analysis roles</h2>
                  <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                    Independent authorization uses separate request and authorization responsibilities.
                  </p>
                </div>
                <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                  Separated
                </span>
              </div>

              <p className="mt-6 text-sm">
                {isBlindingCustodian
                  ? "You are the blinding custodian. The blinded analyst holds the analysis and unblinding-request responsibilities."
                  : isBlindedAnalyst
                    ? "You are the blinded analyst. The blinding custodian retains the authorization responsibility."
                    : "Two different study members hold the request and authorization responsibilities required by this plan."}
              </p>
            </section>
          ) : null}

          {postSetupView === "blinding" ? (
            <section className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">Blinded package</h2>
                  <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                    The blinded package has been registered.
                  </p>
                </div>
                <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                  Registered
                </span>
              </div>

              <dl className="mt-6 grid gap-5 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                    Blinded variable
                  </dt>
                  <dd className="mt-1 text-sm">{transformation.selected_column}</dd>
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

              <p className="mt-6 text-sm text-black/60 dark:text-white/60">
                Dataset contents and the unblinding secret are not stored by blindstats.
              </p>
            </section>
          ) : null}

          {postSetupView === "analysis" ? (
            <section>
              <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">Analysis lock</h2>
                    <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                      {activePlan.require_analysis_lock
                        ? "Register the exact analysis artifact finalized before unblinding."
                        : "An analysis lock is optional under this plan."}
                    </p>
                  </div>
                  <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                    {analysisStatus}
                  </span>
                </div>

                {analysisLocks.length > 0 ? (
                  <div className="mt-6 space-y-3">
                    {analysisLocks.map((lock, index) => (
                      <div
                        className="rounded-xl border border-black/10 p-4 dark:border-white/15"
                        key={lock.id}
                      >
                        <p className="text-sm font-medium">
                          Analysis lock {analysisLocks.length - index}: {lock.analysis_artifact_filename}
                        </p>
                        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                          Registered {new Date(lock.registered_at).toLocaleString("en-US")}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {analysisLocks.length === 0 && !canLockAnalysis ? (
                  <p className="mt-6 text-sm text-black/60 dark:text-white/60">
                    Waiting for the blinded analyst to register an analysis lock.
                  </p>
                ) : null}
              </div>

              {workflow.state === "blinded" && !unblindingRequest && canLockAnalysis ? (
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
              ) : null}
            </section>
          ) : null}

          {postSetupView === "unblinding" && unblindingUnlocked ? (
            <section>
              <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">Unblinding</h2>
                    <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                      {unblindingCompletion
                        ? "Authorized unblinding is complete."
                        : unblindingAuthorization
                          ? "Authorization is complete. The protected mapping has not been released through this workflow yet."
                          : unblindingRequest
                            ? "An unblinding request has been recorded."
                            : "Request unblinding when the blinded analysis is ready."}
                    </p>
                  </div>
                  <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                    {unblindingStatus}
                  </span>
                </div>

                {!unblindingRequest && workflow.state === "blinded" ? (
                  canRequestUnblinding ? (
                    <form action={requestUnblinding} className="mt-6 space-y-4">
                      <input type="hidden" name="studyId" value={study.id} />
                      <input type="hidden" name="workflowId" value={workflow.id} />

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
                              ? "Select a registered analysis lock"
                              : "No analysis lock"}
                          </option>
                          {analysisLocks.map((lock, index) => (
                            <option key={lock.id} value={lock.id}>
                              Analysis lock {analysisLocks.length - index}: {lock.analysis_artifact_filename}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                          {activePlan.require_analysis_lock
                            ? "The request will be permanently linked to the selected analysis lock."
                            : "An analysis lock is optional under this plan."}
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
                    <p className="mt-6 text-sm text-black/60 dark:text-white/60">
                      Waiting for the study member who can request unblinding.
                    </p>
                  )
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
                          A different study member must authorize this request.
                        </p>
                      </>
                    ) : canAuthorizeUnblinding ? (
                      <>
                        <p className="text-sm font-medium">Authorization required</p>
                        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                          {activePlan.authorization_policy === "independent"
                            ? "This request was made by another study member."
                            : "This plan permits self-authorization."}
                        </p>
                        <form action={authorizeUnblinding} className="mt-4">
                          <input type="hidden" name="studyId" value={study.id} />
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
                          Another authorized study member must complete this step.
                        </p>
                      </>
                    )}
                  </div>
                ) : null}

                {workflow.state === "unblinding_authorized" &&
                unblindingRequest &&
                unblindingAuthorization &&
                !unblindingCompletion &&
                !canReceiveUnblinded ? (
                  <div className="mt-6 rounded-xl border border-black/10 p-4 dark:border-white/15">
                    <p className="text-sm font-medium">Secret handoff</p>
                    <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                      {isBlindingCustodian || canAuthorizeUnblinding
                        ? "Send the saved unblinding secret to the blinded analyst through the approved secure file-transfer channel. Do not upload the secret to blindstats."
                        : "Waiting for the authorized recipient to complete local unblinding."}
                    </p>
                  </div>
                ) : null}
              </div>

              {workflow.state === "unblinding_authorized" &&
              unblindingRequest &&
              unblindingAuthorization &&
              !unblindingCompletion &&
              canReceiveUnblinded ? (
                unblindingRequest.analysis_lock_id &&
                !authorizedAnalysisLock ? (
                  <div className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                    <p className="text-sm font-medium">
                      The analysis lock selected by this request could not be loaded.
                    </p>
                  </div>
                ) : (
                  <UnblindingWorkspace
                    registration={{
                      studyId: study.id,
                      workflowId: workflow.id,
                      requestId: unblindingRequest.id,
                      transformationId: transformation.transformation_id,
                      publicReceiptSha256: transformation.public_receipt_sha256,
                      publicReceiptBase64: Buffer.from(
                        transformation.public_receipt_text,
                        "utf8",
                      ).toString("base64"),
                      lockId: authorizedAnalysisLock?.lock_id ?? null,
                      analysisLockReceiptSha256:
                        authorizedAnalysisLock?.analysis_lock_receipt_sha256 ??
                        null,
                      analysisLockReceiptBase64: authorizedAnalysisLock
                        ? Buffer.from(
                            authorizedAnalysisLock.analysis_lock_receipt_text,
                            "utf8",
                          ).toString("base64")
                        : null,
                    }}
                    registerAction={registerUnblindingCompletion}
                  />
                )
              ) : null}
            </section>
          ) : null}

          {postSetupView === "history" ? (
            <section className="space-y-6">
              <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <h2 className="text-xl font-semibold">Audit history</h2>
                <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                  Review durable workflow records and technical identifiers.
                </p>
              </div>

              <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">Blinding plan</h3>
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {new Date(activePlan.activated_at).toLocaleString("en-US")}
                  </span>
                </div>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                      Version
                    </dt>
                    <dd className="mt-1 text-sm">v{activePlan.version_number}</dd>
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
              </div>

              <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">Blinding registration</h3>
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {new Date(transformation.registered_at).toLocaleString("en-US")}
                  </span>
                </div>
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
                      Blinded variable
                    </dt>
                    <dd className="mt-1 text-sm">{transformation.selected_column}</dd>
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
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                      Public receipt SHA-256
                    </dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      {transformation.public_receipt_sha256}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">Analysis locks</h3>
                  <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                    {analysisLocks.length}
                  </span>
                </div>

                {analysisLocks.length === 0 ? (
                  <p className="mt-4 text-sm text-black/60 dark:text-white/60">
                    No analysis lock has been registered.
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
                        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
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
                              Registered
                            </dt>
                            <dd className="mt-1 text-sm">
                              {new Date(lock.registered_at).toLocaleString("en-US")}
                            </dd>
                          </div>
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
              </div>

              <div className="rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <h3 className="text-lg font-semibold">Unblinding</h3>

                {!unblindingRequest ? (
                  <p className="mt-4 text-sm text-black/60 dark:text-white/60">
                    No unblinding request has been recorded.
                  </p>
                ) : (
                  <div className="mt-4 space-y-5">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium">Request</p>
                        <span className="text-xs text-black/50 dark:text-white/50">
                          {new Date(unblindingRequest.requested_at).toLocaleString("en-US")}
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
                              : "Another study member"}
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
                            {selectedRequestLock
                              ? `Analysis lock ${analysisLocks.length - selectedRequestLockIndex}: ${selectedRequestLock.analysis_artifact_filename}`
                              : "No analysis lock selected"}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {unblindingAuthorization ? (
                      <div className="border-t border-black/10 pt-5 dark:border-white/15">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-medium">Authorization</p>
                          <span className="text-xs text-black/50 dark:text-white/50">
                            {new Date(unblindingAuthorization.authorized_at).toLocaleString("en-US")}
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
                                : "Another study member"}
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
                            {new Date(unblindingCompletion.registered_at).toLocaleString("en-US")}
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
                                : "Another study member"}
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
                        </dl>
                        <p className="mt-3 text-xs text-black/50 dark:text-white/50">
                          The secret, plaintext mapping, and final receipt text were not uploaded.
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}

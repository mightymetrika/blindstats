import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  activateBlindingPlan,
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
    stale?: string;
  }>;
};

function formatAuthorizationPolicy(policy: string) {
  return policy === "independent"
    ? "Independent authorization"
    : "Self-authorization permitted";
}

export default async function BlindingWorkflowPage({
  params,
  searchParams,
}: BlindingWorkflowPageProps) {
  const { studyId, workflowId } = await params;
  const { saved, activated, stale } = await searchParams;
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const [
    { data: study, error: studyError },
    { data: workflow, error: workflowError },
    { data: draft, error: draftError },
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

  const protectionTarget = draft.protection_targets[0] ?? "";
  const hasProtectionTarget = protectionTarget.trim().length > 0;
  const hasWeakerPolicy =
    !draft.require_analysis_lock ||
    draft.authorization_policy === "self_authorization";

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
      </header>

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
              <div>
                <h2 className="text-lg font-semibold">
                  BlindingPlan v{activePlan.version_number}
                </h2>
                <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                  This activated plan is immutable.
                </p>
              </div>
              <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                Active
              </span>
            </div>

            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
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
                  Unblinding authorization
                </dt>
                <dd className="mt-1 text-sm">
                  {formatAuthorizationPolicy(
                    activePlan.authorization_policy,
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                  Activated
                </dt>
                <dd className="mt-1 text-sm">
                  {new Date(activePlan.activated_at).toLocaleString("en-US")}
                </dd>
              </div>
            </dl>

            {activePlan.protection_rationale ? (
              <div className="mt-6">
                <p className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                  Protection rationale
                </p>
                <p className="mt-1 text-sm">
                  {activePlan.protection_rationale}
                </p>
              </div>
            ) : null}

            {activePlan.warning_acknowledgements.length > 0 ? (
              <div className="mt-6 rounded-xl border border-black/10 p-4 dark:border-white/15">
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
          </section>

          <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
            <h2 className="text-lg font-semibold">Ready for blinding</h2>
            <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
              Plan v{activePlan.version_number} is active. The workflow remains
              in setup until a blinded package is successfully created and
              registered.
            </p>
          </section>
        </>
      ) : (
        <>
          <section className="mt-10 rounded-2xl border border-black/10 p-6 dark:border-white/15">
            <h2 className="text-lg font-semibold">BlindingPlan draft</h2>
            <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
              Define the protection and governance rules for this workflow. The
              draft remains editable until it is activated.
            </p>

            {saved === "1" ? (
              <p className="mt-4 text-sm font-medium">Draft saved.</p>
            ) : null}

            <form action={saveBlindingPlanDraft} className="mt-6 space-y-6">
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
                  placeholder="For example: treatment identity"
                  type="text"
                />
                <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                  Describe the substantive information the workflow is intended
                  to conceal. The dataset column used for the transformation
                  will be selected separately.
                </p>
              </div>

              <div>
                <label
                  className="text-sm font-medium"
                  htmlFor="protectionRationale"
                >
                  Protection rationale
                </label>
                <textarea
                  className="mt-1 min-h-24 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
                  defaultValue={draft.protection_rationale ?? ""}
                  id="protectionRationale"
                  maxLength={1000}
                  name="protectionRationale"
                  placeholder="Optional short explanation of what the blinding is intended to protect."
                />
              </div>

              <div>
                <label className="text-sm font-medium" htmlFor="lockPolicy">
                  Analysis lock before ordinary unblinding
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
                    Independent authorization (recommended)
                  </option>
                  <option value="self_authorization">
                    Self-authorization permitted
                  </option>
                </select>
              </div>

              <button
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                type="submit"
              >
                Save draft
              </button>
            </form>
          </section>

          <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
            <h2 className="text-lg font-semibold">Activate Plan v1</h2>
            <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
              Activation freezes the current draft as an immutable historical
              plan. It does not create a blinded dataset or move the workflow
              into the blinded state.
            </p>

            {!hasProtectionTarget ? (
              <p className="mt-4 text-sm font-medium">
                Add and save a protection target before activation.
              </p>
            ) : (
              <form action={activateBlindingPlan} className="mt-5">
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
                  className="mt-5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
                  type="submit"
                >
                  Activate Plan v1
                </button>
              </form>
            )}
          </section>
        </>
      )}
    </main>
  );
}

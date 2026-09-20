import { Buffer } from "node:buffer";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AnalysisLockWorkspace } from "@/components/blinding/AnalysisLockWorkspace";
import { BlindingWorkspace } from "@/components/blinding/BlindingWorkspace";
import { createClient } from "@/lib/supabase/server";

import {
  activateBlindingPlan,
  registerAnalysisLock,
  registerBlindingTransformation,
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
  const { saved, activated, blinded, locked, stale } = await searchParams;
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

          {workflow.state === "setup" ? (
            <>
              <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <h2 className="text-lg font-semibold">Ready for blinding</h2>
                <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
                  Plan v{activePlan.version_number} is active. Create the blinded
                  package locally, save all three artifacts, then register the
                  public receipt to move this workflow into the blinded state.
                </p>
              </section>

              <BlindingWorkspace
                registration={{
                  studyId: study.id,
                  workflowId: workflow.id,
                  planVersionNumber: activePlan.version_number,
                }}
                registerAction={registerBlindingTransformation}
              />
            </>
          ) : transformation ? (
            <>
              <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Blinding registered</h2>
                    <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
                      The public receipt and safe transformation metadata are
                      registered. Dataset contents and the unblinding secret were
                      not uploaded as part of this registration.
                    </p>
                  </div>
                  <span className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium dark:border-white/15">
                    {workflow.state.replaceAll("_", " ")}
                  </span>
                </div>

                {blinded === "1" ? (
                  <p className="mt-4 text-sm font-medium">
                    Blinded package registered successfully.
                  </p>
                ) : null}

                <dl className="mt-6 grid gap-5 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                      Transformation ID
                    </dt>
                    <dd className="mt-1 break-all font-mono text-sm">
                      {transformation.transformation_id}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                      Blinded variable
                    </dt>
                    <dd className="mt-1 text-sm">
                      {transformation.selected_column}
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
                      {new Date(transformation.registered_at).toLocaleString(
                        "en-US",
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="mt-6 rounded-2xl border border-black/10 p-6 dark:border-white/15">
                <h2 className="text-lg font-semibold">Analysis locks</h2>
                <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
                  Each registered lock identifies one exact analysis artifact
                  under the registered blinding receipt. Analysis artifact
                  contents are not stored by blindstats.
                </p>

                {locked === "1" ? (
                  <p className="mt-4 text-sm font-medium">
                    Analysis lock registered successfully.
                  </p>
                ) : null}

                {analysisLocks.length === 0 ? (
                  <p className="mt-5 text-sm text-black/60 dark:text-white/60">
                    No analysis lock has been registered yet.
                  </p>
                ) : (
                  <div className="mt-5 space-y-4">
                    {analysisLocks.map((lock, index) => (
                      <div
                        className="rounded-xl border border-black/10 p-4 dark:border-white/15"
                        key={lock.id}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-medium">
                            Analysis lock {analysisLocks.length - index}
                          </p>
                          <span className="text-xs text-black/50 dark:text-white/50">
                            Registered {new Date(lock.registered_at).toLocaleString("en-US")}
                          </span>
                        </div>

                        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                          <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
                              Analysis artifact
                            </dt>
                            <dd className="mt-1 break-all text-sm">
                              {lock.analysis_artifact_filename}
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
                              Receipt created
                            </dt>
                            <dd className="mt-1 text-sm">
                              {new Date(lock.receipt_created_at).toLocaleString("en-US")}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {workflow.state === "blinded" ? (
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

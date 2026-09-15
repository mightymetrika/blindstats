import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { saveBlindingPlanDraft } from "../actions";

type BlindingWorkflowPageProps = {
  params: Promise<{
    studyId: string;
    workflowId: string;
  }>;
  searchParams: Promise<{
    saved?: string;
  }>;
};

export default async function BlindingWorkflowPage({
  params,
  searchParams,
}: BlindingWorkflowPageProps) {
  const { studyId, workflowId } = await params;
  const { saved } = await searchParams;
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
      .select("id, study_id, state, created_at, updated_at")
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

  const protectionTarget = draft.protection_targets[0] ?? "";
  const isSetup = workflow.state === "setup";

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

      <section className="mt-10 rounded-2xl border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-semibold">BlindingPlan draft</h2>
        <p className="mt-2 max-w-3xl text-sm text-black/60 dark:text-white/60">
          Define the protection and governance rules for this workflow. The
          draft remains editable while the workflow is in setup.
        </p>

        {saved === "1" ? (
          <p className="mt-4 text-sm font-medium">Draft saved.</p>
        ) : null}

        <form action={saveBlindingPlanDraft} className="mt-6 space-y-6">
          <input type="hidden" name="studyId" value={study.id} />
          <input type="hidden" name="workflowId" value={workflow.id} />

          <div>
            <label className="text-sm font-medium" htmlFor="protectionTarget">
              Protection target
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 disabled:opacity-60 dark:border-white/20 dark:focus:border-white/50"
              defaultValue={protectionTarget}
              disabled={!isSetup}
              id="protectionTarget"
              maxLength={200}
              name="protectionTarget"
              placeholder="For example: treatment identity"
              type="text"
            />
            <p className="mt-1 text-xs text-black/50 dark:text-white/50">
              Describe the substantive information the workflow is intended to
              conceal. The dataset column used for the transformation will be
              selected separately.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="protectionRationale">
              Protection rationale
            </label>
            <textarea
              className="mt-1 min-h-24 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 disabled:opacity-60 dark:border-white/20 dark:focus:border-white/50"
              defaultValue={draft.protection_rationale ?? ""}
              disabled={!isSetup}
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
              className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 disabled:opacity-60 dark:border-white/20 dark:focus:border-white/50"
              defaultValue={
                draft.require_analysis_lock ? "required" : "not_required"
              }
              disabled={!isSetup}
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
              className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 disabled:opacity-60 dark:border-white/20 dark:focus:border-white/50"
              defaultValue={draft.authorization_policy}
              disabled={!isSetup}
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

          {isSetup ? (
            <button
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
              type="submit"
            >
              Save draft
            </button>
          ) : null}
        </form>
      </section>

      <section className="mt-6 rounded-2xl border border-dashed border-black/20 p-6 dark:border-white/20">
        <h2 className="font-semibold">Plan status</h2>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          No immutable plan version is active yet. Activation will occur only
          when the workflow is ready to enter the blinded state.
        </p>
      </section>
    </main>
  );
}

"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function getRequiredString(formData: FormData, name: string) {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

export async function createBlindingWorkflow(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: existingWorkflow, error: existingError } = await supabase
    .from("blinding_workflows")
    .select("id")
    .eq("study_id", studyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Unable to check for an existing blinding workflow: ${existingError.message}`,
    );
  }

  if (existingWorkflow) {
    redirect(`/studies/${studyId}/blinding/${existingWorkflow.id}`);
  }

  const { data: workflow, error } = await supabase
    .from("blinding_workflows")
    .insert({
      study_id: studyId,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to create blinding workflow: ${error.message}`);
  }

  redirect(`/studies/${studyId}/blinding/${workflow.id}`);
}

export async function saveBlindingPlanDraft(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const targetValue = formData.get("protectionTarget");
  const rationaleValue = formData.get("protectionRationale");
  const lockPolicy = getRequiredString(formData, "lockPolicy");
  const authorizationPolicy = getRequiredString(
    formData,
    "authorizationPolicy",
  );

  const protectionTarget =
    typeof targetValue === "string" ? targetValue.trim() : "";
  const protectionRationale =
    typeof rationaleValue === "string" ? rationaleValue.trim() : "";

  if (protectionTarget.length > 200) {
    throw new Error("Protection target must be 200 characters or fewer.");
  }

  if (protectionRationale.length > 1000) {
    throw new Error("Protection rationale must be 1000 characters or fewer.");
  }

  if (lockPolicy !== "required" && lockPolicy !== "not_required") {
    throw new Error("Analysis-lock policy is invalid.");
  }

  if (
    authorizationPolicy !== "independent" &&
    authorizationPolicy !== "self_authorization"
  ) {
    throw new Error("Unblinding-authorization policy is invalid.");
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("blinding_plan_drafts")
    .update({
      protection_targets: protectionTarget ? [protectionTarget] : [],
      protection_rationale: protectionRationale || null,
      require_analysis_lock: lockPolicy === "required",
      authorization_policy: authorizationPolicy,
    })
    .eq("workflow_id", workflowId)
    .eq("study_id", studyId);

  if (error) {
    throw new Error(`Unable to save BlindingPlan draft: ${error.message}`);
  }

  redirect(`/studies/${studyId}/blinding/${workflowId}?saved=1`);
}

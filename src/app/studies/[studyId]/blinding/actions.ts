"use server";

import { Buffer } from "node:buffer";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { parseAnalysisLockReceiptBytes } from "@/lib/blinding/analysis-lock-receipt";
import { parseBlindingReceiptBytes } from "@/lib/blinding/blinding-receipt";
import { createClient } from "@/lib/supabase/server";

function getRequiredString(formData: FormData, name: string) {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

function redirectToCurrentWorkflow(
  studyId: string,
  workflowId: string,
  query:
    | "saved=1"
    | "activated=1"
    | "stale=1"
    | "requested=1"
    | "authorized=1",
) {
  revalidatePath(`/studies/${studyId}`);
  revalidatePath(`/studies/${studyId}/blinding/${workflowId}`);

  redirect(
    `/studies/${studyId}/blinding/${workflowId}?${query}`,
    RedirectType.replace,
  );
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

  const { data: workflow, error: workflowError } = await supabase
    .from("blinding_workflows")
    .select("state, active_plan_version_id")
    .eq("id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (workflowError) {
    throw new Error(
      `Unable to verify blinding workflow: ${workflowError.message}`,
    );
  }

  if (!workflow) {
    throw new Error("Blinding workflow not found.");
  }

  if (
    workflow.state !== "setup" ||
    workflow.active_plan_version_id !== null
  ) {
    redirectToCurrentWorkflow(studyId, workflowId, "stale=1");
  }

  const { data: updatedDraft, error } = await supabase
    .from("blinding_plan_drafts")
    .update({
      protection_targets: protectionTarget ? [protectionTarget] : [],
      protection_rationale: protectionRationale || null,
      require_analysis_lock: lockPolicy === "required",
      authorization_policy: authorizationPolicy,
    })
    .eq("workflow_id", workflowId)
    .eq("study_id", studyId)
    .select("workflow_id")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to save BlindingPlan draft: ${error.message}`);
  }

  if (!updatedDraft) {
    redirectToCurrentWorkflow(studyId, workflowId, "stale=1");
  }

  redirectToCurrentWorkflow(studyId, workflowId, "saved=1");
}

export async function activateBlindingPlan(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const acknowledgeWeakerPolicies =
    formData.get("acknowledgeWeakerPolicies") === "on";

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("activate_blinding_plan", {
    p_workflow_id: workflowId,
    p_acknowledge_weaker_policies: acknowledgeWeakerPolicies,
  });

  if (error) {
    throw new Error(`Unable to activate BlindingPlan: ${error.message}`);
  }

  redirectToCurrentWorkflow(studyId, workflowId, "activated=1");
}

export type RegisterBlindingTransformationResult =
  | {
      ok: true;
      transformationRecordId: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function registerBlindingTransformation(
  formData: FormData,
): Promise<RegisterBlindingTransformationResult> {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const publicReceiptBase64Value = formData.get("publicReceiptBase64");
  const acknowledgedCustody = formData.get("acknowledgeCustody") === "on";

  if (
    typeof publicReceiptBase64Value !== "string" ||
    publicReceiptBase64Value.length === 0
  ) {
    return {
      ok: false,
      error: "A public blinding receipt is required for registration.",
    };
  }

  if (!acknowledgedCustody) {
    return {
      ok: false,
      error:
        "Confirm that the blinded CSV, public receipt, and unblinding secret have been saved before registration.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("blinding_workflows")
    .select("state, active_plan_version_id")
    .eq("id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (workflowError) {
    return {
      ok: false,
      error: `Unable to verify blinding workflow: ${workflowError.message}`,
    };
  }

  if (!workflow) {
    return {
      ok: false,
      error: "Blinding workflow not found.",
    };
  }

  if (workflow.state !== "setup") {
    return {
      ok: false,
      error:
        "This workflow is no longer in setup. Reload the workflow before continuing.",
    };
  }

  if (!workflow.active_plan_version_id) {
    return {
      ok: false,
      error: "An active BlindingPlan is required before registration.",
    };
  }

  let publicReceiptBytes: Uint8Array;
  let publicReceiptText: string;

  try {
    if (
      publicReceiptBase64Value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(publicReceiptBase64Value)
    ) {
      throw new Error("Public blinding receipt transport encoding is invalid.");
    }

    const decoded = Buffer.from(publicReceiptBase64Value, "base64");

    if (decoded.toString("base64") !== publicReceiptBase64Value) {
      throw new Error("Public blinding receipt transport encoding is invalid.");
    }

    publicReceiptBytes = new Uint8Array(decoded);
    parseBlindingReceiptBytes(publicReceiptBytes);
    publicReceiptText = new TextDecoder("utf-8", { fatal: true }).decode(
      publicReceiptBytes,
    );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Unable to validate public blinding receipt: ${error.message}`
          : "Unable to validate public blinding receipt.",
    };
  }

  const { data, error } = await supabase.rpc(
    "register_blinding_transformation",
    {
      p_workflow_id: workflowId,
      p_public_receipt_text: publicReceiptText,
    },
  );

  if (error) {
    return {
      ok: false,
      error: `Unable to register blinded package: ${error.message}`,
    };
  }

  if (typeof data !== "string" || data.length === 0) {
    return {
      ok: false,
      error:
        "The blinded package was registered, but its server record could not be confirmed.",
    };
  }

  revalidatePath(`/studies/${studyId}`);
  revalidatePath(`/studies/${studyId}/blinding/${workflowId}`);

  return {
    ok: true,
    transformationRecordId: data,
  };
}

export type RegisterAnalysisLockResult =
  | {
      ok: true;
      lockRecordId: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function registerAnalysisLock(
  formData: FormData,
): Promise<RegisterAnalysisLockResult> {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const receiptBase64Value = formData.get("analysisLockReceiptBase64");

  if (
    typeof receiptBase64Value !== "string" ||
    receiptBase64Value.length === 0
  ) {
    return {
      ok: false,
      error: "An analysis-lock receipt is required for registration.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("blinding_workflows")
    .select("state")
    .eq("id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (workflowError) {
    return {
      ok: false,
      error: `Unable to verify blinding workflow: ${workflowError.message}`,
    };
  }

  if (!workflow) {
    return {
      ok: false,
      error: "Blinding workflow not found.",
    };
  }

  if (workflow.state !== "blinded") {
    return {
      ok: false,
      error:
        "Analysis-lock registration requires the workflow to be blinded. Reload the workflow before continuing.",
    };
  }

  let receiptText: string;

  try {
    if (
      receiptBase64Value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(receiptBase64Value)
    ) {
      throw new Error("Analysis-lock receipt transport encoding is invalid.");
    }

    const decoded = Buffer.from(receiptBase64Value, "base64");

    if (decoded.toString("base64") !== receiptBase64Value) {
      throw new Error("Analysis-lock receipt transport encoding is invalid.");
    }

    const receiptBytes = new Uint8Array(decoded);
    parseAnalysisLockReceiptBytes(receiptBytes);
    receiptText = new TextDecoder("utf-8", { fatal: true }).decode(
      receiptBytes,
    );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Unable to validate analysis-lock receipt: ${error.message}`
          : "Unable to validate analysis-lock receipt.",
    };
  }

  const { data, error } = await supabase.rpc("register_analysis_lock", {
    p_workflow_id: workflowId,
    p_analysis_lock_receipt_text: receiptText,
  });

  if (error) {
    return {
      ok: false,
      error: `Unable to register analysis lock: ${error.message}`,
    };
  }

  if (typeof data !== "string" || data.length === 0) {
    return {
      ok: false,
      error:
        "The analysis lock was registered, but its server record could not be confirmed.",
    };
  }

  revalidatePath(`/studies/${studyId}`);
  revalidatePath(`/studies/${studyId}/blinding/${workflowId}`);

  return {
    ok: true,
    lockRecordId: data,
  };
}

export async function requestUnblinding(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const analysisLockIdValue = formData.get("analysisLockId");
  const analysisLockId =
    typeof analysisLockIdValue === "string" &&
    analysisLockIdValue.trim().length > 0
      ? analysisLockIdValue.trim()
      : null;

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: workflow, error: workflowError } = await supabase
    .from("blinding_workflows")
    .select("state")
    .eq("id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (workflowError) {
    throw new Error(
      `Unable to verify blinding workflow: ${workflowError.message}`,
    );
  }

  if (!workflow) {
    throw new Error("Blinding workflow not found.");
  }

  if (workflow.state !== "blinded") {
    throw new Error(
      "Unblinding can only be requested while the workflow is blinded.",
    );
  }

  const { data, error } = await supabase.rpc("request_unblinding", {
    p_workflow_id: workflowId,
    p_analysis_lock_id: analysisLockId,
  });

  if (error) {
    throw new Error(`Unable to request unblinding: ${error.message}`);
  }

  if (typeof data !== "string" || data.length === 0) {
    throw new Error(
      "The unblinding request was registered, but its server record could not be confirmed.",
    );
  }

  redirectToCurrentWorkflow(studyId, workflowId, "requested=1");
}

export async function authorizeUnblinding(formData: FormData) {
  const studyId = getRequiredString(formData, "studyId");
  const workflowId = getRequiredString(formData, "workflowId");
  const requestId = getRequiredString(formData, "requestId");

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: request, error: requestError } = await supabase
    .from("unblinding_requests")
    .select("id")
    .eq("id", requestId)
    .eq("workflow_id", workflowId)
    .eq("study_id", studyId)
    .maybeSingle();

  if (requestError) {
    throw new Error(
      `Unable to verify unblinding request: ${requestError.message}`,
    );
  }

  if (!request) {
    throw new Error("Unblinding request not found.");
  }

  const { data, error } = await supabase.rpc("authorize_unblinding", {
    p_request_id: requestId,
  });

  if (error) {
    throw new Error(`Unable to authorize unblinding: ${error.message}`);
  }

  if (typeof data !== "string" || data.length === 0) {
    throw new Error(
      "Unblinding was authorized, but its server record could not be confirmed.",
    );
  }

  redirectToCurrentWorkflow(studyId, workflowId, "authorized=1");
}
